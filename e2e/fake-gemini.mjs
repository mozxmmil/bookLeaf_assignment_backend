/**
 * Tiny local stand-in for the Gemini REST API, used only by the E2E "AI happy path" run.
 * Classification requests (JSON mode) get a category/priority; draft requests get a reply
 * that echoes facts from the prompt, so the test can verify the KB + facts were sent.
 */
import http from 'node:http';
const port = Number(process.env.FAKE_GEMINI_PORT ?? 4999);
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    if (req.headers['x-goog-api-key'] !== 'fake-key') { res.writeHead(401); return res.end('bad key'); }
    const prompt = j.contents?.[0]?.parts?.[0]?.text ?? '';
    let text;
    if (j.generationConfig?.responseMimeType === 'application/json') {
      const royalty = /royalt/i.test(prompt);
      text = JSON.stringify({ category: royalty ? 'ROYALTY_PAYMENTS' : 'GENERAL_INQUIRY', priority: royalty ? 'HIGH' : 'LOW', reason: 'Fake Gemini classification' });
    } else {
      const payout = /Next scheduled payout date: ([^\n]+)/.exec(prompt)?.[1] ?? 'soon';
      const pending = /pending: (₹[\d,]+)/.exec(prompt)?.[1] ?? '';
      text = `Hi Priya,\n\nI completely understand how worrying it is not to see your royalty. Your pending royalty is ${pending}, and the next scheduled payout date is ${payout}. I've asked our finance team to verify your bank details and we will get back to you within 48 hours.\n\nAisha, BookLeaf Author Support`;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: Math.ceil(prompt.length / 4), candidatesTokenCount: Math.ceil(text.length / 4) } }));
  });
}).listen(port, () => console.log(`fake gemini on :${port}`));
