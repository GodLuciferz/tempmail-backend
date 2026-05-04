const express = require('express');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  'https://cdvlbqislahfhjptlbuj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkdmxicWlzbGFoZmhqcHRsYnVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDA1NTgsImV4cCI6MjA5MzQ3NjU1OH0.mUJa6EmXOTcZfJQ8lBXr4luOERUn3Of-YJbGpeEMmzs'
);

const GMAIL_ACCOUNTS = [
  {
    user: 'darknoxno07hindi@gmail.com',
    password: 'kyja cjrd tqwl tlfx',
    domain: 'apknox.online'
  },
  {
    user: 'darknoxno07@gmail.com',
    password: 'jafj csid qoip qbzm',
    domain: 'noxzone111.online'
  }
];

function generateRandomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

function fetchEmails(account) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: account.user,
      password: account.password,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) {
          imap.end();
          resolve();
          return;
        }

        imap.search(['UNSEEN'], (err, results) => {
          if (err || !results.length) {
            imap.end();
            resolve();
            return;
          }

          const f = imap.fetch(results, { bodies: '' });
          const tasks = [];

          f.on('message', (msg) => {
            msg.on('body', (stream) => {
              const task = simpleParser(stream)
                .then(async (parsed) => {
                  const toAddress = parsed.to?.text?.toLowerCase();
                  const fromAddress = parsed.from?.text || '';
                  const subject = parsed.subject || '(No Subject)';
                  const bodyText = parsed.text || '';
                  const bodyHtml = parsed.html || '';

                  if (!toAddress) return;

                  const { data: inbox } = await supabase
                    .from('inboxes')
                    .select('email')
                    .eq('email', toAddress)
                    .single();

                  if (!inbox) return;

                  const { data: existing } = await supabase
                    .from('emails')
                    .select('id')
                    .eq('to_address', toAddress)
                    .eq('from_address', fromAddress)
                    .eq('subject', subject)
                    .limit(1);

                  if (existing && existing.length > 0) return;

                  await supabase.from('emails').insert({
                    to_address: toAddress,
                    from_address: fromAddress,
                    subject,
                    body_text: bodyText,
                    body_html: bodyHtml
                  });

                  console.log(`Email saved: ${subject} -> ${toAddress}`);
                })
                .catch((err) => {
                  console.log(`Parse/save error (${account.domain}):`, err.message);
                });

              tasks.push(task);
            });
          });

          f.once('error', (err) => {
            console.log(`Fetch error (${account.domain}):`, err.message);
            imap.end();
            resolve();
          });

          f.once('end', async () => {
            await Promise.all(tasks);
            imap.end();
            resolve();
          });
        });
      });
    });

    imap.once('error', (err) => {
      console.log(`IMAP error (${account.domain}):`, err.message);
      resolve();
    });

    imap.once('end', () => {
      resolve();
    });

    imap.connect();
  });
}

// Poll every 30 seconds
let isPolling = false;

cron.schedule('*/30 * * * * *', async () => {
  if (isPolling) return;

  isPolling = true;
  console.log('Polling emails...');

  try {
    await Promise.all(GMAIL_ACCOUNTS.map(fetchEmails));
  } finally {
    isPolling = false;
  }
});

// API Routes
app.get('/', (req, res) => res.json({ status: 'TempMail backend running!' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/generate', async (req, res) => {
  const domains = ['apknox.online', 'noxzone111.online'];
  const randomUser = generateRandomString(8);
  const randomDomain = domains[Math.floor(Math.random() * domains.length)];
  const email = `${randomUser}@${randomDomain}`;

  const { error } = await supabase.from('inboxes').insert({
    email
  });

  if (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }

  res.json({
    success: true,
    email
  });
});

app.get('/inbox/:address', async (req, res) => {
  const { address } = req.params;

  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .eq('to_address', address.toLowerCase())
    .order('received_at', { ascending: false });

  if (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }

  res.json({
    success: true,
    email: address.toLowerCase(),
    inbox: data
  });
});

app.get('/emails/:address', async (req, res) => {
  const { address } = req.params;

  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .eq('to_address', address.toLowerCase())
    .order('received_at', { ascending: false });

  if (error) return res.status(500).json({ error });

  res.json(data);
});

app.delete('/inbox/:address', async (req, res) => {
  const { address } = req.params;

  await supabase.from('emails').delete().eq('to_address', address.toLowerCase());
  await supabase.from('inboxes').delete().eq('email', address.toLowerCase());

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
