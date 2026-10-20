import {expect,it} from 'vitest';
import {parseCashAmount} from '../src/cash';
it('parses exact fiat minor units and refuses rounding, exponent and overflow',()=>{
 expect(parseCashAmount('20,00')).toBe(2000);expect(parseCashAmount('12.5')).toBe(1250);expect(parseCashAmount('0')).toBe(0);
 expect(parseCashAmount('21474836.47')).toBe(2147483647);
 for(const s of ['','-1','1.001','1e2','21474836.48','0x10','NaN'])expect(parseCashAmount(s)).toBeNull();
});
