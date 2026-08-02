/**
 * WhatsApp Flows Encryption Helpers
 * TypeScript version
 */

import crypto from "crypto";

export interface DecryptedRequest {
  decryptedBody: any;
  aesKeyBuffer: Buffer;
  initialVectorBuffer: Buffer;
}

export class FlowEndpointException extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);

    this.name = "FlowEndpointException";
    this.statusCode = statusCode;
  }
}

export function decryptRequest(
  body: any,
  privatePem: string,
  passphrase: string = ""
): DecryptedRequest {
  const {
    encrypted_aes_key,
    encrypted_flow_data,
    initial_vector,
  } = body;

  let privateKey;

  try {
    privateKey = crypto.createPrivateKey({
      key: privatePem,
      passphrase,
    });
  } catch (err) {
    console.error("Unable to load private key", err);

    throw new FlowEndpointException(
      500,
      "Unable to load private key."
    );
  }

  let decryptedAesKey: Buffer;

  try {
    decryptedAesKey = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encrypted_aes_key, "base64")
    );
  } catch (err) {
    console.error("RSA decrypt failed", err);

    throw new FlowEndpointException(
      421,
      "Failed to decrypt the request. Please verify your private key."
    );
  }

  const flowDataBuffer = Buffer.from(
    encrypted_flow_data,
    "base64"
  );

  const initialVectorBuffer = Buffer.from(
    initial_vector,
    "base64"
  );

  const TAG_LENGTH = 16;

  const encryptedBody = flowDataBuffer.subarray(
    0,
    -TAG_LENGTH
  );

  const authTag = flowDataBuffer.subarray(
    -TAG_LENGTH
  );

  const decipher = crypto.createDecipheriv(
    "aes-128-gcm",
    decryptedAesKey,
    initialVectorBuffer
  );

  decipher.setAuthTag(authTag);

  const decryptedJSONString = Buffer.concat([
    decipher.update(encryptedBody),
    decipher.final(),
  ]).toString("utf8");

  return {
    decryptedBody: JSON.parse(decryptedJSONString),
    aesKeyBuffer: decryptedAesKey,
    initialVectorBuffer,
  };
}

export function encryptResponse(
  response: unknown,
  aesKeyBuffer: Buffer,
  initialVectorBuffer: Buffer
): string {
  const flippedIV = Buffer.from(
    initialVectorBuffer.map((b) => ~b)
  );

  const cipher = crypto.createCipheriv(
    "aes-128-gcm",
    aesKeyBuffer,
    flippedIV
  );

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(response), "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return Buffer.concat([
    encrypted,
    tag,
  ]).toString("base64");
}
