// SPDX-License-Identifier: GPL-3.0-or-later
const MiB=1024**2,GiB=1024**3;
const choices=['auto','0.5','1','2','4','8','16'];
class CacheBudget {
 constructor(preference='auto'){this.preference=choices.includes(preference)?preference:'auto';this.budget=0;this.recovery=0;}
 update(total,free,used=0,force=false){
  const target=this.preference==='auto'?Math.min(4*GiB,total/8):Number(this.preference)*GiB;
  const reserve=Math.max(GiB,total*0.1);
  const ceiling=Math.max(128*MiB,Math.min(target,used+free-reserve));
  if(!this.budget||force){this.budget=Math.min(ceiling,this.preference==='auto'?Math.max(128*MiB,free/4):target);this.recovery=0;}
  else if(ceiling<this.budget){this.budget=ceiling;this.recovery=0;}
  else if(free>reserve+512*MiB){
   if(++this.recovery>=5){this.budget=Math.min(ceiling,this.budget+256*MiB);this.recovery=0;}
  }else this.recovery=0;
  this.budget=Math.floor(this.budget);
  return {preference:this.preference,budget:this.budget,adjusted:this.budget<target-64*MiB};
 }
}
module.exports={CacheBudget,choices};
