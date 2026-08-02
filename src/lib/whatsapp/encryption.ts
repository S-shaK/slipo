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
  passphrase = ""
): DecryptedRequest {
  const {
    encrypted_aes_key,
    encrypted_flow_data,
    initial_vector,
  } = body;

  let decryptedAesKey: Buffer;

  try {
    decryptedAesKey = crypto.privateDecrypt(
      {
        key: privatePem,
        passphrase,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encrypted_aes_key, "base64")
    );
  } catch (err) {
    console.error("Flow decrypt failed:", err);

    throw new FlowEndpointException(
      421,
      "Failed to decrypt. Refresh the public key."
    );
  }

  try {
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
  } catch (err) {
    console.error("AES decrypt failed:", err);

    throw new FlowEndpointException(
      500,
      "Unable to decrypt flow payload."
    );
  }
}

export function encryptResponse(
  response: unknown,
  aesKeyBuffer: Buffer,
  initialVectorBuffer: Buffer
): string {
  const flippedIV = Buffer.from(
    initialVectorBuffer.map((b) => (~b) & 0xff)
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

  const authTag = cipher.getAuthTag();

  return Buffer.concat([
    encrypted,
    authTag,
  ]).toString("base64");
}
