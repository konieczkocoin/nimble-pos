import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {MerchantTerminal} from '../src/merchant/Merchant'
vi.mock('@nimiq/mini-app-sdk',async original=>({...await original<object>(),getHostLanguage:()=> 'pl'}))
vi.mock('../src/AppContext',()=>({useApp:()=>({token:null,api:{baseUrl:'/api'}}),useAppOptional:()=>null}))
vi.mock('qrcode',()=>({toCanvas:vi.fn(async()=>{})}))
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals()})
it('renders the restored Polish cashier basket and actions without English source labels',async()=>{
 const venue={id:'v',name:'Kawiarnia',fiatCurrency:'EUR'},employee={id:'e',name:'Anna',active:true,role:'CASHIER',permissions:[]}
 sessionStorage.setItem('nimble:merchant:/api:cashier',JSON.stringify({token:'staff',venue,employee}))
 const json=(v:unknown)=>new Response(JSON.stringify(v))
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.endsWith('/session'))return json({venue,employee})
  if(url.endsWith('/terminal/profiles'))return json({venue,employees:[employee]})
  if(url.endsWith('/current'))return json({id:'s',openedAt:new Date().toISOString()})
  if(url.endsWith('/rates'))return json({NIM:null,USDT:null})
  if(url.includes('/report'))return json({totals:{fiatCurrency:'EUR',count:0,paid:0,grossMinor:0,netMinor:0,refundedMinor:0,assets:{NIM:'0',USDT:'0'}},orders:[]})
  return json([])
 }))
 render(<MemoryRouter><MerchantTerminal/></MemoryRouter>)
 expect(await screen.findByRole('heading',{name:'Coś dobrego na Twój dzień.'})).toBeTruthy()
 expect(screen.getByRole('heading',{name:'Twój koszyk.'})).toBeTruthy()
 expect(screen.getByRole('button',{name:/^Udostępnij płatność/})).toBeTruthy()
 expect(screen.queryByText('Choose something from the menu.')).toBeNull()
})
