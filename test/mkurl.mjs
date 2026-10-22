import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(root,'index.html'),'utf8')
  .match(/<div id="root"><\/div>\s*<script>([\s\S]*?)\n<\/script>/)[1];
const grab = (...n)=>n.map(x=>new RegExp('\\nfunction '+x+'\\([\\s\\S]*?\\n\\}','m').exec(src)[0]).join('\n');
const ctx={TextEncoder,TextDecoder,CompressionStream,Response,btoa,atob,URL,console,Promise,Math,JSON,Array,String,Number,Uint8Array};
vm.createContext(ctx);
vm.runInContext("var VERSION='1';var te=new TextEncoder(),td=new TextDecoder();\n"+
  grabVar('EC')+grabVar('SIGALG')+grab('gzipStr','toB64url','fromB64url','importPrivate','encodeSigned','slugify','guessTitle'),ctx);
const [base,...files]=process.argv.slice(2);
for(const f of files){
  const html=fs.readFileSync(f,'utf8');
  const title=ctx.guessTitle(html)||path.basename(f).replace(/\.html?$/i,'');
  const slug=ctx.slugify(title);
  const p=await ctx.encodeSigned({v:1,title,slug,html,claudeShim:true});
  const url=base.replace(/\/$/,'')+'/#'+p;
  console.log('\n'+title+'  ['+slug+']  '+url.length+' chars');
  console.log(url);
}
