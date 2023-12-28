import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import fs from 'fs/promises';
import path from 'path';
import process from "process";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

// Initial Setup
dotenv.config();
const app = express();
app.use(express.json());
app.use(bodyParser.json({ limit: "30mb", extended: true }));
app.use(bodyParser.urlencoded({ limit: "30mb", extended: true }));
const corsOptions ={
  origin:'*', 
  credentials:true,            
  optionSuccessStatus:200,
}
app.use(cors(corsOptions));


app.get("/", (req, res)=>{
  console.log("testing");
    res.json("Auto mail service is running");
});

// Lacal path setting

const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// setting scopes

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send'
];

// Retreve OAuth token if generated

async function loadSavedCredentialsIfExist() {
  try {
      const content = await fs.readFile(TOKEN_PATH);
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
  } catch (err) {
      return null;
  }
}

// Save token for next time

async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

// Authorize the token

async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
      return client;
  }
  
  client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
      await saveCredentials(client);
  }
  return client;
}



async function main() {
  const auth = await authorize();
  const labelId = await createLabel(auth);
  setInterval(async () => {
      const messages = await getUnrepliedMessages(auth);
      console.log(`UNREPLIED MESSAGES: ${messages.length}`);
      for (let message of messages) {
          await sendReply(auth, message);
          console.log(`REPLIED TO: ${message.id}`)
          await addLabel(auth, message, labelId)
          console.log(`ADDED LABEL TO: ${message.id}`)
      }
  }, Math.floor(Math.random() * (10 - 5 + 1) + 5) * 1000);
}


// Get all the un replied mails 

async function getUnrepliedMessages(auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'in:inbox is:unread'
  })
  return res.data.messages || [];
}

// Send Replies

async function sendReply(auth, message) {
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From'],
  });

  const subject = res.data.payload.headers.find((header) => header.name == 'Subject').value;
  const from = res.data.payload.headers.find((header) => header.name == 'From').value;

  const replyTo = from.match(/<(.*)>/)[1];
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const replyBody = `Dear, \n\n we have received your mail. Currently, I am out of station and will reply soon. \n\n Regards,\n Aman`

  const rawMessage = [
      `From: me`,
      `To: ${replyTo}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${message.id}`,
      `References: ${message.id}`,
      ``,
      replyBody
  ].join('\n');

  const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '-').replace(/=+$/, '');

  await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
          raw: encodedMessage,
      },
  });
}

// Create label

const LABEL_NAME = 'PENDING';
async function createLabel(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  try {
      const res = await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
              name: LABEL_NAME,
              labelListVisibility: 'labelShow',
              messageListVisibility: 'show'
          }
      })
      return res.data.id;
  } catch (err) {
      if (err.code === 409) {
          //label already exist
          const res = await gmail.users.labels.list({
              userId: 'me'
          })
          const label = res.data.labels.find((label) => label.name === LABEL_NAME);
          return label.id;
      } else {
          throw err;
      }
  }
}

// Add label 

async function addLabel(auth, message, labelId) {
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.modify({
      id: message.id,
      userId: 'me',
      requestBody: {
          addLabelIds: [labelId],
          removeLabelIds: ['INBOX'],
      },
  });
}

// call authorize and then auto mail reply is started.
authorize().then(main).catch(console.error);


// Server Setup
const PORT = process.env.PORT || 6000;
app.listen(PORT, () => console.log(`Server Port: ${PORT}`));

