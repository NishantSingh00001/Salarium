// Request schemas (zod). The model's own vocabulary is checked afterwards by validate().

import { z } from "zod";

const label = z.string().trim().min(1).max(80);

export const ProfileSchema = z.object({
  country: label,
  yearsPro: z.number().int().min(0).max(50),
  yearsCode: z.number().int().min(0).max(60).optional(),
  role: label,
  education: label,
  orgSize: label,
  manager: label,
  remote: label,
  industry: label,
  employment: label,
  skills: z.array(z.string().max(60)).max(60).transform((s) => [...new Set(s)]),
});

export type ProfileInput = z.infer<typeof ProfileSchema>;
