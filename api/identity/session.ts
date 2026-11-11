import { ObjectId } from "mongodb";
import { csrf, digest, opaque } from "./crypto";
import type { Credential, Realm, Session } from "./models";
import type { SessionResult } from "./service";
export function newSession(
  key: string,
  now: Date,
  realm: Realm,
  principal?: { _id: ObjectId; authEpoch: number; churchId?: ObjectId },
  credential?: Credential,
  absolute?: Date,
): SessionResult {
  const token = opaque(),
    tokenHash = digest(token),
    kind = principal
      ? credential?.kind === "temporary"
        ? "password_change"
        : "full"
      : "bootstrap";
  const deadline = new Date(
    absolute ?? now.getTime() + (kind === "full" ? 8 * 60 * 60_000 : 15 * 60_000),
  );
  if (
    kind === "password_change" &&
    credential?.temporaryExpiresAt &&
    credential.temporaryExpiresAt < deadline
  )
    deadline.setTime(credential.temporaryExpiresAt.getTime());
  const csrfToken = csrf(key, realm, tokenHash);
  const session: Session = {
    _id: new ObjectId(),
    tokenHash,
    realm,
    churchId: realm === "church" ? (principal?.churchId ?? null) : null,
    kind,
    ...(principal && credential
      ? {
          principalId: principal._id,
          authEpoch: principal.authEpoch,
          credentialVersion: credential.credentialVersion,
          lastPasswordVerifiedAt: now,
        }
      : {}),
    csrfTokenHash: digest(csrfToken),
    csrfKeyVersion: 1,
    createdAt: now,
    lastActivityAt: now,
    absoluteExpiresAt: deadline,
    writeFence: 0,
  };
  return { token, session, csrfToken };
}
