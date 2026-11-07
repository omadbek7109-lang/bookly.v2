import{a as T}from"./chunk-5RECOTEJ.js";import{a as B,d as O,e as v,f as S,h as f,i as h}from"./chunk-4NFM7FB3.js";import{g as y}from"./chunk-RFMDZKR4.js";import{h as i,i as g,m as j}from"./chunk-5KIOMDUW.js";import{a as H}from"./chunk-4MUY77VC.js";import{c as Z}from"./chunk-B35RROQB.js";var P=Z(H(),1);var N={"image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/webp":"webp","audio/mpeg":"mp3","audio/mp4":"m4a","audio/ogg":"ogg","audio/wav":"wav","audio/x-wav":"wav","audio/webm":"webm","audio/aac":"aac"},W=new Set(["image/png","image/jpeg","image/gif","image/webp","audio/mpeg","audio/mp4"]);function $(o){return o.map(e=>{let r=i(e.text);return e.underline&&(r=`<span class="u">${r}</span>`),e.italic&&(r=`<em>${r}</em>`),e.bold&&(r=`<strong>${r}</strong>`),e.br?`${r}<br/>`:r}).join("")}function x(o,e,r,l={}){return`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${h(o)}" lang="${h(o)}">
<head>
  <meta charset="UTF-8"/>
  <title>${i(e)}</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body${l.bodyClass?` class="${l.bodyClass}"`:""}${l.epubType?` epub:type="${l.epubType}"`:""}>
${r}
</body>
</html>`}function X(o){let e=y(o.theme.bodyFont).css,r=y(o.theme.headingFont).css,l=o.theme.accent;return`@charset "UTF-8";
body { font-family: ${e}; line-height: 1.6; color: ${o.theme.ink}; margin: 0 5%; }
h1, h2, h3, h4 { font-family: ${r}; line-height: 1.25; page-break-after: avoid; }
h1.chapter-title { font-size: 1.8em; margin: 0.2em 0 1em; padding-bottom: 0.4em; border-bottom: 2px solid ${l}; }
p.chapter-label { font-family: sans-serif; text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75em; color: ${l}; margin: 3em 0 0; font-weight: bold; }
p { margin: 0 0 0.8em; text-align: justify; }
.align-left { text-align: left; } .align-center { text-align: center; } .align-right { text-align: right; } .align-justify { text-align: justify; }
blockquote { margin: 1.2em 0; padding: 0.2em 0 0.2em 1em; border-left: 3px solid ${l}; font-style: italic; }
blockquote cite { display: block; font-style: normal; font-size: 0.85em; color: #6b6b7b; margin-top: 0.3em; }
.u { text-decoration: underline; }
figure { margin: 1.2em 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; height: auto; }
figure.small img { max-width: 45%; } figure.medium img { max-width: 70%; }
figcaption { font-size: 0.85em; color: #6b6b7b; font-style: italic; margin-top: 0.4em; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.9em; }
th, td { border: 1px solid #c9c7d9; padding: 0.35em 0.5em; text-align: left; vertical-align: top; }
th { background: #edebfb; }
hr { border: 0; border-top: 1px solid ${l}; width: 30%; margin: 2em auto; }
.pagebreak { page-break-after: always; break-after: page; }
.audio { margin: 1em 0; padding: 0.6em; border: 1px solid #e3e1f0; border-radius: 6px; }
.audio p { margin: 0 0 0.4em; font-size: 0.9em; color: ${l}; }
.title-page { text-align: center; margin-top: 20%; }
.title-page h1 { font-size: 2.2em; margin-bottom: 0.2em; }
.title-page .subtitle { font-style: italic; color: #6b6b7b; text-align: center; }
.title-page .author { margin-top: 2em; text-align: center; }
.title-page .description { margin-top: 2em; font-size: 0.9em; color: #6b6b7b; text-align: center; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100%; }
nav ol { list-style: none; padding-left: 0; } nav li { margin: 0.4em 0; } nav a { text-decoration: none; color: inherit; }
`}async function ee(o){let{book:e,assets:r,options:l}=o,d=j(e),c=new P.default;c.file("mimetype","application/epub+zip",{compression:"STORE"}),c.file("META-INF/container.xml",`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);let p=[],u=[],b=new Map,w=t=>{if(!W.has(t.mime)&&!t.mime.startsWith("audio/"))return null;let a=b.get(t.id);if(a)return a.href;let s=`${t.mime.startsWith("audio/")?"audio":"images"}/${t.id}.${N[t.mime]??"bin"}`;return c.file(`OEBPS/${s}`,t.bytes),b.set(t.id,{href:s,mime:t.mime}),s};if(c.file("OEBPS/css/style.css",X(e)),p.push('<item id="css" href="css/style.css" media-type="text/css"/>'),l.includeCover&&o.cover){let t=o.cover.mime==="image/png"?"png":"jpg";c.file(`OEBPS/images/cover.${t}`,o.cover.bytes),p.push(`<item id="cover-image" href="images/cover.${t}" media-type="${o.cover.mime}" properties="cover-image"/>`),c.file("OEBPS/cover.xhtml",x(e,e.title,`<section class="cover" epub:type="cover"><img src="images/cover.${t}" alt="${i(e.title)}"/></section>`)),p.push('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>'),u.push('<itemref idref="cover" linear="yes"/>')}let I=`<section class="title-page" epub:type="titlepage">
  <h1>${i(e.title)}</h1>
  ${e.subtitle?`<p class="subtitle">${i(e.subtitle)}</p>`:""}
  ${e.author?`<p class="author">${i(S(e))} ${i(e.author)}</p>`:""}
  ${e.description?`<p class="description">${$(g(e.description))}</p>`:""}
</section>`;c.file("OEBPS/title.xhtml",x(e,e.title,I)),p.push('<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>'),u.push('<itemref idref="title"/>');let z=d?`<li><a href="chapter-1.xhtml">${i(e.title)}</a></li>`:e.chapters.map((t,a)=>`<li><a href="chapter-${a+1}.xhtml">${i(f(e,t,a))}</a></li>`).join(`
      `),F=`<nav epub:type="toc" id="toc"><h1>${i(v(e))}</h1>
    <ol>
      ${z}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="hidden"><ol>
    <li><a epub:type="titlepage" href="title.xhtml">${i(e.title)}</a></li>
    <li><a epub:type="bodymatter" href="chapter-1.xhtml">${i(f(e,e.chapters[0],0))}</a></li>
  </ol></nav>`;c.file("OEBPS/nav.xhtml",x(e,v(e),F)),p.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'),u.push(`<itemref idref="nav" linear="${l.includeToc&&!d?"yes":"no"}"/>`),e.chapters.forEach((t,a)=>{let n=f(e,t,a),s=[`<section epub:type="${d?"bodymatter":"chapter"}" id="chapter-${a+1}">`,...d?[]:[`<p class="chapter-label">${i(O(e,a))}</p>`,`<h1 class="chapter-title">${i(n)}</h1>`],...t.blocks.map(m=>A(m)),"</section>"].join(`
`);c.file(`OEBPS/chapter-${a+1}.xhtml`,x(e,d?e.title:n,s)),p.push(`<item id="ch${a+1}" href="chapter-${a+1}.xhtml" media-type="application/xhtml+xml"/>`),u.push(`<itemref idref="ch${a+1}"/>`)});function A(t){let a="align"in t&&t.align?` class="align-${t.align}"`:"";switch(t.type){case"heading":return`<h${t.level+1}${a}>${$(g(t.html))}</h${t.level+1}>`;case"paragraph":{let n=$(g(t.html));return n?`<p${a}>${n}</p>`:""}case"quote":return`<blockquote><p>${$(g(t.html))}</p>${t.cite?`<cite>\u2014 ${i(t.cite)}</cite>`:""}</blockquote>`;case"list":{let n=t.ordered?"ol":"ul",s=t.items.filter(m=>m.trim()).map(m=>`<li>${$(g(m))}</li>`).join("");return s?`<${n}>${s}</${n}>`:""}case"image":{let n=t.assetId?r[t.assetId]:void 0,s=n?w(n):null;return s?`<figure class="${t.width}"><img src="${s}" alt="${i(t.caption||"image")}"/>${t.caption?`<figcaption>${i(t.caption)}</figcaption>`:""}</figure>`:""}case"table":{let n=t.rows.map((q,D)=>{let E=t.header&&D===0?"th":"td";return`<tr>${q.map(L=>`<${E}>${i(L)}</${E}>`).join("")}</tr>`}),s=t.header&&n.length?`<thead>${n[0]}</thead>`:"",m=(t.header?n.slice(1):n).join("");return`<table>${s}<tbody>${m}</tbody></table>`}case"divider":return"<hr/>";case"pagebreak":return'<div class="pagebreak"></div>';case"audio":{let n=t.assetId?r[t.assetId]:void 0,s=n?w(n):null,m=i(t.title||"Audio");return s?`<div class="audio"><p>\u266A ${m}</p><audio controls="controls" src="${s}"><a href="${s}">${m}</a></audio></div>`:`<div class="audio"><p>\u266A ${m}</p></div>`}default:return""}}let C={n:0};for(let[t,a]of b)p.push(`<item id="m-${++C.n}-${t}" href="${a.href}" media-type="${a.mime}"/>`);let k=_(e.id),M=`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${h(e)}">
  <head><meta name="dtb:uid" content="urn:uuid:${k}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
  <docTitle><text>${i(e.title)}</text></docTitle>
  <navMap>
${(d?e.chapters.slice(0,1):e.chapters).map((t,a)=>`    <navPoint id="np${a+1}" playOrder="${a+1}"><navLabel><text>${i(f(e,t,a))}</text></navLabel><content src="chapter-${a+1}.xhtml"/></navPoint>`).join(`
`)}
  </navMap>
</ncx>`;c.file("OEBPS/toc.ncx",M),p.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');let R=new Date(e.updatedAt).toISOString().replace(/\.\d{3}Z$/,"Z"),U=`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${h(e)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${k}</dc:identifier>
    <dc:title>${i(e.title)}</dc:title>
    <dc:language>${h(e)}</dc:language>
    <dc:creator id="author">${i(e.author||"Bookly")}</dc:creator>
    ${e.description?`<dc:description>${i(e.description)}</dc:description>`:""}
    ${e.metadata.publisher?`<dc:publisher>${i(e.metadata.publisher)}</dc:publisher>`:""}
    ${e.metadata.rights?`<dc:rights>${i(e.metadata.rights)}</dc:rights>`:""}
    <dc:subject>${i(e.category)}</dc:subject>
    ${e.metadata.keywords.map(t=>`<dc:subject>${i(t)}</dc:subject>`).join(`
    `)}
    <dc:date>${new Date(e.createdAt).toISOString().slice(0,10)}</dc:date>
    <meta property="dcterms:modified">${R}</meta>
    <meta name="generator" content="Bookly 2.0"/>
    ${l.includeCover&&o.cover?'<meta name="cover" content="cover-image"/>':""}
  </metadata>
  <manifest>
    ${p.join(`
    `)}
  </manifest>
  <spine toc="ncx">
    ${u.join(`
    `)}
  </spine>
</package>`;return c.file("OEBPS/content.opf",U.replace(/\n\s*\n/g,`
`)),{bytes:await c.generateAsync({type:"uint8array",compression:"DEFLATE",compressionOptions:{level:6},mimeType:"application/epub+zip"}),mime:T.epub,filename:B(e,"epub"),extension:"epub"}}function _(o){let e="";for(let r=0;e.length<32;r++)e+=(o.charCodeAt(r%o.length)*(r+7)%16).toString(16);return`${e.slice(0,8)}-${e.slice(8,12)}-4${e.slice(13,16)}-a${e.slice(17,20)}-${e.slice(20,32)}`}export{ee as exportEpub};
//# sourceMappingURL=epub-ECFKDUZZ.js.map
