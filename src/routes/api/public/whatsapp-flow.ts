import { createFileRoute } from "@tanstack/react-router";
import {
  createDecipheriv,
  createCipheriv,
  createHmac,
  timingSafeEqual,
  privateDecrypt,
  constants,
  createPublicKey,
} from "node:crypto";

type FlowRequest = {
  version: string;
  action: "ping" | "INIT" | "data_exchange" | "BACK";
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
};

function loadPrivateKey() {
  const raw = process.env.WHATSAPP_FLOW_PRIVATE_KEY;

  if (!raw) {
    throw new Error("WHATSAPP_FLOW_PRIVATE_KEY is not set");
  }

  let pem = raw
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .trim();

  // Fix single-line environment variables
  if (!pem.includes("\n")) {
    const body = pem
      .replace("-----BEGIN PRIVATE KEY-----", "")
      .replace("-----END PRIVATE KEY-----", "")
      .replace(/\s+/g, "");

    const wrapped = body.match(/.{1,64}/g)?.join("\n");

    pem = `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
  }

  return { pem };
}


// Validate key on startup without printing it
try {
  const { pem } = loadPrivateKey();

  createPublicKey({
    key: pem,
  });

} catch {
  console.error("FAILED TO LOAD PRIVATE KEY");
}


function decryptRequest(body: {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}) {

  const { pem } = loadPrivateKey();

  let aesKey: Buffer;

  try {

    aesKey = privateDecrypt(
      {
        key: pem,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(body.encrypted_aes_key, "base64"),
    );

  } catch {
    throw new Error("RSA decrypt failed");
  }


  const flowDataBuffer = Buffer.from(
    body.encrypted_flow_data,
    "base64"
  );

  const iv = Buffer.from(
    body.initial_vector,
    "base64"
  );


  const TAG_LEN = 16;

  const encrypted = flowDataBuffer.subarray(
    0,
    flowDataBuffer.length - TAG_LEN
  );

  const tag = flowDataBuffer.subarray(
    flowDataBuffer.length - TAG_LEN
  );


  try {

    const decipher = createDecipheriv(
      "aes-128-gcm",
      aesKey,
      iv
    );

    decipher.setAuthTag(tag);


    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);


    return {
      decrypted: JSON.parse(
        decrypted.toString("utf8")
      ) as FlowRequest,

      aesKey,
      iv,
    };


  } catch {

    throw new Error("AES decrypt failed");

  }
}


function encryptResponse(
  payload: unknown,
  aesKey: Buffer,
  iv: Buffer
) {

  // Meta requires flipped IV
  const flippedIv = Buffer.from(
    iv.map((b) => b ^ 0xff)
  );


  const cipher = createCipheriv(
    "aes-128-gcm",
    aesKey,
    flippedIv
  );


  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify(payload),
      "utf8"
    ),
    cipher.final(),
  ]);


  const tag = cipher.getAuthTag();


  return Buffer.concat([
    encrypted,
    tag,
  ]).toString("base64");
}
