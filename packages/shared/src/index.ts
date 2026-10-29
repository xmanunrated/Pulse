import { z } from 'zod';
export const ActivityImportRowSchema = z.object({
  externalRef: z.string().trim().max(100).optional(), staffRef: z.string().trim().min(1).max(120),
  village: z.string().trim().min(1).max(120), district: z.string().trim().max(120).optional(),
  activityDate: z.iso.date(), productSku: z.string().trim().min(1).max(80),
  reportedFarmerCount: z.number().int().min(1).max(100000),
});
export const ConsentStatusSchema = z.enum(['unknown','eligible','declined','withdrawn','suppressed']);
export const AssessmentSchema = z.object({
  callId: z.string().uuid(), communicationScore: z.number().min(0).max(100).nullable(),
  understandingScore: z.number().min(0).max(100).nullable(), confidence: z.number().min(0).max(1).nullable(),
  reviewStatus: z.enum(['pending','not_required','required','in_review','approved','overturned']),
  answers: z.array(z.object({ questionId: z.string(), answer: z.string(), score: z.union([z.literal(0),z.literal(1),z.literal(2)]).nullable(), evidenceRef: z.string().optional(), confidence: z.number().min(0).max(1).nullable() }))
});
export type ActivityImportRow = z.infer<typeof ActivityImportRowSchema>;
export type Assessment = z.infer<typeof AssessmentSchema>;
