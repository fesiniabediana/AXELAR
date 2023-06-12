import { defineStore } from 'pinia';
import { useBlockchain } from './useBlockchain';
import numeral from 'numeral';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import updateLocale from 'dayjs/plugin/updateLocale';
import utc from 'dayjs/plugin/utc';
import localeData from 'dayjs/plugin/localeData';
import { useStakingStore } from './useStakingStore';
import { fromBase64, fromBech32, fromHex, toHex } from '@cosmjs/encoding';
import { consensusPubkeyToHexAddress } from '@/libs';
import { useBankStore } from './useBankStore';
import type { Coin, DenomTrace } from '@/types';
import { useDashboard } from './useDashboard';

dayjs.extend(localeData);
dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.extend(updateLocale);
dayjs.extend(utc);
dayjs.updateLocale('en', {
  relativeTime: {
    future: 'in %s',
    past: '%s ago',
    s: '%ds',
    m: '1m',
    mm: '%dm',
    h: 'an hour',
    hh: '%d hours',
    d: 'a day',
    dd: '%d days',
    M: 'a month',
    MM: '%d months',
    y: 'a year',
    yy: '%d years',
  },
});

export const useFormatter = defineStore('formatter', {
  state: () => {
    return {
      ibcDenoms: {} as Record<string, DenomTrace>,
    };
  },
  getters: {
    blockchain() {
      return useBlockchain();
    },
    staking() {
      return useStakingStore();
    },
    useBank() {
      return useBankStore();
    },
    dashboard() {
      return useDashboard();
    },
  },
  actions: {
    async fetchDenomTrace(denom: string) {
      const hash = denom.replace('ibc/', '');
      let trace = this.ibcDenoms[hash];
      if (!trace) {
        trace = (await this.blockchain.rpc.getIBCAppTransferDenom(hash))
          .denom_trace;
        this.ibcDenoms[hash] = trace;
      }
      return trace;
    },
    priceInfo(denom: string) {
      const id = this.dashboard.coingecko[denom]?.coinId || "";
      const prices = this.dashboard.prices[id];
      return prices;
    },
    priceColor(denom: string, currency = "usd") {
      const change = this.priceChanges(denom, currency)
      switch (true) {
        case change > 0:
          return "text-success"
        case change < 0:
          return "text-error"
        default:
          return ""
      }
    },
    price(denom: string, currency = "usd") {
      if(!denom || denom.length < 2) return 0
      const info = this.priceInfo(denom);
      return info ? info[currency] || 0 : 0;
    },
    priceChanges(denom: string, currency = 'usd'): number {
      const info = this.priceInfo(denom);
      return info ? info[`${currency}_24h_change`] || 0 : 0;
    },
    showChanges(v: number) {
      return v!==0 ? numeral(v).format("+0,0.[00]"): ""
    },
    tokenValue(token?: Coin) {
      if(token) {
        return numeral(this.tokenValueNumber(token)).format("0,0.[00]")
      }
      return ""
    },
    specialDenom(denom: string) {
      switch(true) {
        case denom.startsWith('u'): return 6
        case denom.startsWith("a"): return 18
        case denom==='inj': return 18
      }
      return 0
    },
    tokenValueNumber(token?: Coin) {
      if(!token || !token.denom) return 0
      // find the symbol, 
      const symbol = this.dashboard.coingecko[token.denom]?.symbol || token.denom 
      // convert denomation to to symbol
      const exponent =
        this.dashboard.coingecko[symbol?.toLowerCase()]?.exponent || this.specialDenom(token.denom);
      // cacualte amount of symbol
      const amount = Number(token.amount) / (10 ** exponent)
      const value = amount * this.price(token.denom)
      return value
    },
    formatTokenAmount(token: { denom: string; amount: string }) {
      return this.formatToken(token, false);
    },
    formatToken2(token: { denom: string; amount: string }, withDenom = true) {
      return this.formatToken(token, true, '0,0.[00]');
    },
    findGlobalAssetConfig(denom: string) {
      const chains = Object.values(this.dashboard.chains)
      for ( let i =0; i < chains.length; i++ ) {
        const conf = chains[i].assets.find(a => a.base === denom)
        if(conf) {
          return conf
        }
      }
      return null
    },
    formatToken(
      token?: { denom: string; amount: string },
      withDenom = true,
      fmt = '0,0.[0]',
      mode = 'local'
    ): string {
      if (token && token.amount && token?.denom) {
        let amount = Number(token.amount);
        let denom = token.denom;

        if (denom && denom.startsWith('ibc/')) {
          let ibcDenom = this.ibcDenoms[denom.replace('ibc/', '')];
          if (ibcDenom) {
            denom = ibcDenom.base_denom;
          }
        }

        const conf = mode === 'local'? this.blockchain.current?.assets?.find(
          // @ts-ignore
          (x) => x.base === token.denom || x.base.denom === token.denom
        ): this.findGlobalAssetConfig(token.denom)

        if (conf) {
          let unit = { exponent: 6, denom: '' };
          // find the max exponent for display
          conf.denom_units.forEach((x) => {
            if (x.exponent >= unit.exponent) {
              unit = x;
            }
          });
          if (unit && unit.exponent > 0) {
            amount = amount / Math.pow(10, unit.exponent || 6);
            denom = unit.denom.toUpperCase();
          }
        }
        return `${numeral(amount).format(fmt)} ${
          withDenom ? denom.substring(0, 10) : ''
        }`;
      }
      return '-';
    },
    formatTokens(
      tokens?: { denom: string; amount: string }[],
      withDenom = true,
      fmt = '0.0a'
    ): string {
      if (!tokens) return '';
      return tokens.map((x) => this.formatToken(x, withDenom, fmt)).join(', ');
    },
    calculateBondedRatio(
      pool: { bonded_tokens: string; not_bonded_tokens: string } | undefined
    ) {
      if (pool && pool.bonded_tokens) {
        const b = Number(pool.bonded_tokens);
        const nb = Number(pool.not_bonded_tokens);
        const p = b / (b + nb);
        return numeral(p).format('0.[00]%');
      }
      return '-';
    },
    validator(address: string) {
      if (!address) return address;

      const txt = toHex(fromBase64(address)).toUpperCase();
      const validator = this.staking.validators.find(
        (x) => consensusPubkeyToHexAddress(x.consensus_pubkey) === txt
      );
      return validator?.description?.moniker;
    },
    // find validator by operator address
    validatorFromBech32(address: string) {
      if (!address) return address;
      const validator = this.staking.validators.find(
        (x) => x.operator_address === address
      );
      return validator?.description?.moniker;
    },
    calculatePercent(input?: string | number, total?: string | number) {
      if (!input || !total) return '0';
      const percent = Number(input) / Number(total);
      return numeral(percent > 0.0001 ? percent : 0).format('0.[00]%');
    },
    formatDecimalToPercent(decimal: string) {
      return numeral(decimal).format('0.[00]%');
    },
    formatCommissionRate(rate?: string) {
      if (!rate) return '-';
      return this.percent(rate);
    },
    percent(decimal?: string | number) {
      return decimal ? numeral(decimal).format('0.[00]%') : '-';
    },
    formatNumber(input: number, fmt = '0.[00]') {
      return numeral(input).format(fmt)
    },
    numberAndSign(input: number, fmt = '+0,0') {
      return numeral(input).format(fmt);
    },
    toDay(time?: string | number| Date, format = 'long') {
      if (!time) return '';
      if (format === 'long') {
        return dayjs(time).format('YYYY-MM-DD HH:mm');
      }
      if (format === 'date') {
        return dayjs(time).format('YYYY-MM-DD');
      }
      if (format === 'time') {
        return dayjs(time).format('HH:mm:ss');
      }
      if (format === 'from') {
        return dayjs(time).fromNow();
      }
      if (format === 'to') {
        return dayjs(time).toNow();
      }
      return dayjs(time).format('YYYY-MM-DD HH:mm:ss');
    },
    messages(msgs: { '@type'?: string; typeUrl?: string }[]) {
      if (msgs) {
        const sum: Record<string, number> = msgs
          .map((msg) => {
            const msgType = msg['@type'] || msg.typeUrl || 'unknown';
            return msgType
              .substring(msgType.lastIndexOf('.') + 1)
              .replace('Msg', '');
          })
          .reduce((s, c) => {
            const sh: Record<string, number> = s;
            if (sh[c]) {
              sh[c] += 1;
            } else {
              sh[c] = 1;
            }
            return sh;
          }, {});
        const output: string[] = [];
        Object.keys(sum).forEach((k) => {
          output.push(sum[k] > 1 ? `${k}×${sum[k]}` : k);
        });
        return output.join(', ');
      }
    },
    multiLine(v: string) {
      return v ? v.replaceAll('\\n', '\n') : '';
    },
    hexToString(hex: string) {
      if (hex) {
        return new TextDecoder().decode(fromHex(hex));
      }
      return '';
    },
    base64ToString(hex: string) {
      if (hex) {
        return new TextDecoder().decode(fromBase64(hex));
      }
      return '';
    },
  },
});
