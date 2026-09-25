// Bundles index.html + src/*.js into single-file pages:
//   dist/rivalry-bowl.html  standalone page (open it anywhere, host it anywhere)
//   dist/artifact.html      same content without the html/head/body wrapper,
//                           the form claude.ai artifacts expect
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const block = (name) => {
  const m = html.match(new RegExp(`<!-- BUILD:${name} -->([\\s\\S]*?)<!-- /BUILD:${name} -->`));
  if (!m) throw new Error('missing block ' + name);
  return m[1].trim();
};
const head = block('HEAD'), body = block('BODY');
const scripts = [...block('SCRIPTS').matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => {
  const src = fs.readFileSync(path.join(root, m[1]), 'utf8');
  if (/<\/script/i.test(src)) throw new Error(`${m[1]} contains a closing script tag`);
  return `<script>\n/* ${m[1]} */\n${src}\n</script>`;
}).join('\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
${head}
</head>
<body>
${body}
${scripts}
</body>
</html>
`;
const artifact = `${head}\n${body}\n${scripts}\n`;
// The public page has only the live room, which can't pair two phones on one
// Claude account; its lobby points those players to the online version.
const ONLINE_URL = process.env.ONLINE_URL || 'https://claude.ai/artifact/1XQQJgf8rqbWnCp9Hb6GEF';
const pub = `${head}\n${body}\n<script>window.RB_ONLINE_URL = ${JSON.stringify(ONLINE_URL)};</script>\n${scripts}\n`;
fs.writeFileSync(path.join(root, 'dist/rivalry-bowl.html'), standalone);
fs.writeFileSync(path.join(root, 'dist/artifact.html'), pub);
// Same page, published separately with the db capability as an online backup
// (a db page is private to the owner's organization, so it gets its own link).
const online = artifact.replace('<title>Rivalry Bowl</title>', '<title>Rivalry Bowl Online</title>');
if (online === artifact) throw new Error('title not found');
fs.writeFileSync(path.join(root, 'dist/artifact-online.html'), online);
console.log('dist/rivalry-bowl.html', standalone.length, 'bytes');
console.log('dist/artifact.html', pub.length, 'bytes');
console.log('dist/artifact-online.html', online.length, 'bytes');
