// Сглобява приложението в един файл за публикуване: node build-artifact.js → dist/tabla.html
const fs = require('fs'), path = require('path');
const rd = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = rd('index.html');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/\s*<script src="[^"]+"><\/script>/g, '');
const scripts = ['js/engine.js', 'js/board.js', 'js/rules.js', 'js/sound.js', 'js/strat-core.js', 'js/strategies-data.js', 'js/strategies.js', 'js/online.js', 'js/app.js'].map((f) => {
  const src = rd(f);
  if (/<\/script/i.test(src)) throw new Error('</script> in ' + f);
  return `<script>\n${src}\n</script>`;
});
const out = `<title>Школа по табла</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${rd('css/style.css')}
</style>
${body.trim()}
<script>window.TABLA_OFFLINE = true;</script>
${scripts.join('\n')}
`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'tabla.html'), out);
console.log('dist/tabla.html', out.length, 'bytes');
