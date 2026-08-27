import { DEFAULT_EXPORT_V2_BRANDING } from "./branding";
import { downloadExportV2Blob } from "./download";
import { buildExportV2FileName } from "./file-name";
import { exportV2FormatValue } from "./formatters";
import { buildPdfFromJpegPages } from "./pdf";
import type { ExportV2Report, ExportV2Value } from "./types";

const W=1131,H=1600,M=54,FOOT=1542;
const C={ink:"#172033",navy:"#101828",white:"#fff",gold:"#C49A3A",paleGold:"#FBF5E7",green:"#177A55",paleGreen:"#EDF7F2",red:"#A3324A",paleRed:"#FBEFF2",soft:"#F7F8FA",border:"#D9DEE7",muted:"#667085"};
const FONT='Tahoma, Arial, "Segoe UI", sans-serif';
function font(ctx:CanvasRenderingContext2D,size:number,weight=500){ctx.font=`${weight} ${size}px ${FONT}`;}
function rr(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number,fill:string,stroke?:string){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
function text(ctx:CanvasRenderingContext2D,value:unknown,x:number,y:number,max:number,opt:{size?:number;weight?:number;color?:string;align?:CanvasTextAlign;dir?:CanvasDirection}={}){ctx.save();ctx.direction=opt.dir||"rtl";ctx.textAlign=opt.align||"right";ctx.textBaseline="top";ctx.fillStyle=opt.color||C.ink;font(ctx,opt.size||16,opt.weight||500);let t=String(value??"—");while(ctx.measureText(t).width>max&&t.length>2)t=t.slice(0,-2)+"…";ctx.fillText(t,x,y,max);ctx.restore();}
function summary(report:ExportV2Report<Record<string,ExportV2Value>>,token:string){return report.summary.find(i=>i.label.includes(token));}
function load(src?:string){if(!src)return Promise.resolve<HTMLImageElement|null>(null);return new Promise<HTMLImageElement|null>(resolve=>{const i=new Image();i.crossOrigin="anonymous";const timer=setTimeout(()=>resolve(null),4000);i.onload=()=>{clearTimeout(timer);resolve(i)};i.onerror=()=>{clearTimeout(timer);resolve(null)};i.src=src;});}
async function jpeg(canvas:HTMLCanvasElement){const b=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error("تعذر إنشاء PDF كشف الراتب.")),"image/jpeg",0.95));return new Uint8Array(await b.arrayBuffer());}

export async function buildPayrollPayslipExecutivePdfBytes<Row extends Record<string,ExportV2Value>>(input:ExportV2Report<Row>){
  if(typeof document==="undefined") throw new Error("تصدير PDF يتطلب المتصفح.");
  if(document.fonts?.ready) await document.fonts.ready;
  const report=input as unknown as ExportV2Report<Record<string,ExportV2Value>>;
  const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;const ctx=canvas.getContext("2d",{alpha:false});if(!ctx)throw new Error("تعذر إنشاء كشف الراتب.");ctx.fillStyle=C.white;ctx.fillRect(0,0,W,H);
  const branding={...DEFAULT_EXPORT_V2_BRANDING,...report.branding};const logo=await load(branding.logoUrl);
  rr(ctx,M,34,W-M*2,150,22,C.navy,C.navy);ctx.fillStyle=C.gold;rr(ctx,M+2,36,W-M*2-4,7,3,C.gold);
  const right=W-M-24;if(logo){const ratio=Math.min(150/logo.width,62/logo.height);const w=logo.width*ratio,h=logo.height*ratio;rr(ctx,right-180,72,180,72,14,C.white);ctx.drawImage(logo,right-165,77,w,h);}else{text(ctx,"مَلِكات",right,84,170,{size:28,weight:900,color:C.gold});}
  text(ctx,"كشف راتب موظفة",right-210,66,600,{size:34,weight:900,color:C.white});text(ctx,report.subtitle||"—",right-210,111,600,{size:17,weight:700,color:"#D5D9E2"});
  rr(ctx,M+20,76,205,64,13,"#161C29",C.gold);text(ctx,"رمز التقرير",M+205,87,160,{size:11,weight:700,color:"#B8BFCC"});text(ctx,report.reportCode||"HR-PAYSLIP",M+205,108,160,{size:17,weight:900,color:C.gold});

  const meta=[...[{label:"الفترة",value:report.period}],...(report.filters||[]).slice(0,3).map(i=>({label:i.label,value:i.value}))];let mx=right,my=205;const mw=(W-M*2-30)/4;for(let i=0;i<4;i++){const item=meta[i]||{label:"",value:""};const x=mx-mw;rr(ctx,x,my,mw,64,12,C.white,C.border);text(ctx,item.label,x+mw-14,my+10,mw-28,{size:11,weight:700,color:C.muted});text(ctx,item.value,x+mw-14,my+32,mw-28,{size:14,weight:900});mx=x-10;}

  const cards=[summary(report,"الراتب الأساسي"),summary(report,"إجمالي الإضافات"),summary(report,"تعويض رصيد الإجازات"),summary(report,"إجمالي الخصومات"),summary(report,"الصافي")].filter(Boolean);const gap=10,cw=(W-M*2-gap*4)/5,cy=292;let cr=right;cards.forEach((item,index)=>{const x=cr-cw;const isNet=index===cards.length-1;const isDed=item!.label.includes("خصومات");const isComp=item!.label.includes("تعويض رصيد");const bg=isNet?C.navy:isDed?C.paleRed:isComp?C.paleGold:item!.label.includes("إضافات")?C.paleGreen:C.white;const accent=isNet?C.white:isDed?C.red:isComp?C.gold:item!.label.includes("إضافات")?C.green:C.gold;rr(ctx,x,cy,cw,92,14,bg,isNet?C.navy:C.border);text(ctx,item!.label,x+cw-14,cy+14,cw-28,{size:11,weight:700,color:isNet?"#C5CBD6":C.muted});text(ctx,exportV2FormatValue(item!.value,item!.type),x+cw-14,cy+48,cw-28,{size:17,weight:900,color:accent});cr=x-gap;});

  text(ctx,"تفاصيل الاستحقاقات والخصومات",right,414,W-M*2,{size:18,weight:900});const ty=450;const cols=[430,190,W-M*2-620];let x=right;["البند","القيمة","ملاحظة"].forEach((h,i)=>{const w=cols[i];const l=x-w;ctx.fillStyle=C.navy;ctx.fillRect(l,ty,w,42);text(ctx,h,l+w/2,ty+12,w-12,{size:12,weight:900,color:C.white,align:"center"});x=l;});let y=492;for(let i=0;i<report.rows.length;i++){const r=report.rows[i],h=48;x=right;const label=String(r.item||"");const val=Number(r.value||0);const valueColor=label.includes("خصم")||label.includes("الخصومات")?C.red:label.includes("تعويض رصيد")?"#8A6600":label.includes("الصافي")?C.green:C.ink;[r.item,exportV2FormatValue(val,"currency"),r.note||"—"].forEach((v,ci)=>{const w=cols[ci],l=x-w;ctx.fillStyle=i%2?C.soft:C.white;ctx.fillRect(l,y,w,h);ctx.strokeStyle=C.border;ctx.strokeRect(l,y,w,h);text(ctx,v,ci===1?l+w/2:l+w-10,y+14,w-20,{size:ci===2?11:12,weight:ci===1||ci===0?700:500,color:ci===1?valueColor:C.ink,align:ci===1?"center":"right"});x=l;});y+=h;}
  const available=FOOT-y-28;if(available>100){rr(ctx,M,y+18,W-M*2,Math.min(available,145),15,C.soft,C.border);text(ctx,"ملاحظة محاسبية",right-16,y+32,W-M*2-32,{size:15,weight:900});text(ctx,"تعويض رصيد الإجازات بند مستقل عن الإضافات والمكافآت. بعد اعتماد الراتب يصبح مبلغ الصرف ثابتًا، وأي فرق لاحق يُرحّل كتسوية موثقة للفترة التالية.",right-16,y+60,W-M*2-32,{size:12,weight:600,color:C.muted});if(report.notes?.[0])text(ctx,report.notes[0],right-16,y+92,W-M*2-32,{size:11,weight:600,color:C.muted});}
  ctx.strokeStyle=C.border;ctx.beginPath();ctx.moveTo(M,FOOT-15);ctx.lineTo(W-M,FOOT-15);ctx.stroke();text(ctx,"مَلِكات • كشف راتب سري للاستخدام الإداري والموظفة",right,FOOT-5,600,{size:10,weight:700,color:C.muted});text(ctx,"1 / 1",M,FOOT-5,90,{size:10,weight:700,color:C.muted,align:"left",dir:"ltr"});
  const bytes=await jpeg(canvas);return buildPdfFromJpegPages([{bytes,width:W,height:H}],595.28,841.89);
}

export async function exportPayrollPayslipExecutivePdf<Row extends Record<string,ExportV2Value>>(report:ExportV2Report<Row>){const bytes=await buildPayrollPayslipExecutivePdfBytes(report);downloadExportV2Blob(new Blob([bytes],{type:"application/pdf"}),buildExportV2FileName(report,"pdf"));}
