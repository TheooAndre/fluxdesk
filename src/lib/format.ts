export function money(n:number,compact=true):string{if(!Number.isFinite(n))return '—';return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:compact?'compact':'standard',maximumFractionDigits:compact?2:4}).format(n);}
export function price(n:number):string{if(!Number.isFinite(n)||n<=0)return '—';const dp=n>=100?2:n>=1?4:n>=.01?5:8;return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:dp});}
export function pct(n:number){return (n>0?'+':'')+n.toFixed(2)+'%';}
export function short(n:number){return Number.isFinite(n)?n.toFixed(2):'—';}
export function clock(time:number){return new Date(time).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});}
