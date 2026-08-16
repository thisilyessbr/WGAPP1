import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { prisma } from './testDb';
import { bootstrapChatbot } from '../bootstrap';
import { createDevChatRouter } from '../dev/chatApi';

let app: express.Application;
let deps: any;

import { PDFDocument } from 'pdf-lib';

describe('Real PDF Upload Test', () => {
  beforeAll(async () => {
    deps = bootstrapChatbot(prisma);
    app = express();
    app.use(express.json());
    app.use('/api/dev', createDevChatRouter(deps));
    await request(app).post('/api/dev/bootstrap').send();
  });

  it('uploads a real PDF', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    page.drawText('This is valid knowledge base content for testing uploads.', { x: 50, y: 350 });
    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(pdfBytes);

    const res = await request(app)
      .post('/api/dev/upload?tenantId=dev-tenant')
      .attach('document', pdfBuffer, 'test.pdf');

    console.log('Response:', res.body);
    expect(res.status).toBe(200);
  });
});
