import { z } from 'zod';

export const uploadRequestSchema = z.object({
  fileName: z.string().min(1, 'File name is required'),
  contentType: z.enum(['application/pdf'], {
    message: 'Only PDF files are supported',
  }),
});

export type UploadRequest = z.infer<typeof uploadRequestSchema>;
