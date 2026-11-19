// worker/index.mjs — thin Cloudflare adapter: wires the real `send_email` binding into the tested core.
// All behaviour (auth, size cap, shape whitelist, mail text) lives in relay-core.mjs. No value is hard-coded here.
import { handleRelay } from './relay-core.mjs';

export default {
  async fetch(request, env) {
    return handleRelay(request, env, {
      // Email Service Workers API: env.EMAIL.send({ to, from, subject, text }). Plain text only.
      send: (mail) => env.EMAIL.send({ to: mail.to, from: mail.from, subject: mail.subject, text: mail.text }),
      log: (line) => console.log(line),
      now: () => Date.now()
    });
  }
};
