import { z } from "zod";
export const qrPayload = z.string().regex(/^QLHT1:[A-Za-z0-9_-]{43}$/);
