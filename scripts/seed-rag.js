// Utility: Seeds knowledge base with the standard Atlas Assistant knowledge document and ingests chunks.
// Usage: npm run rag:seed or node scripts/seed-rag.js [tenantId]

require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const fs = require('fs');

let dbUrl = process.env.DATABASE_URL;
if (dbUrl && dbUrl.startsWith('prisma+postgres://')) {
  const urlObj = new URL(dbUrl);
  const apiKey = urlObj.searchParams.get('api_key');
  if (apiKey) {
    const decoded = JSON.parse(Buffer.from(apiKey, 'base64').toString('utf8'));
    dbUrl = decoded.databaseUrl;
  }
}

const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const textContent = `Atlas Assistant — Test Knowledge Base

Company Overview
Atlas Assistant is a fictional software company that provides customer-support automation tools for small and medium-sized businesses.

Support
Support hours: Monday to Friday, 09:00–18:00.
Support email: support@atlas.example.
Normal response time: within 24 hours.

Plans and Pricing
Plan Price Description
Starter $19/month Basic customer-support automation.
Professional $79/month Advanced automation and analytics.
Enterprise Contact sales Custom limits, integrations, and support.

Refund Policy
Customers may request a refund within 30 days of purchase. Refund requests should be sent to support@atlas.example.

Account Management
Customers can change their subscription plan by contacting the Atlas support team. Enterprise customers can request custom plans and contractual terms.

Security
Atlas Assistant does not require customers to share passwords or API secrets with support agents. Sensitive credentials should never be sent through normal support messages.

Important Test Information
This document is fictional and exists only for testing the chatbot's retrieval and knowledge-grounding behavior.`;

async function run() {
  const tenantId = process.argv[2] || 'dev-tenant';
  console.log(`Clearing existing documents and chunks for tenant "${tenantId}"...`);
  await prisma.knowledgeChunk.deleteMany({ where: { tenantId } });
  await prisma.knowledgeDocument.deleteMany({ where: { tenantId } });
  await prisma.knowledgeSource.deleteMany({ where: { tenantId } });

  console.log("Generating atlas_assistant_test_knowledge.pdf in memory...");
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText(textContent, { x: 50, y: 750, size: 12, font, lineHeight: 15 });
  const pdfBytes = await pdfDoc.save();

  console.log("Uploading to http://localhost:3000/api/dev/upload...");
  const formData = new FormData();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  formData.append('document', blob, 'atlas_assistant_test_knowledge.pdf');
  formData.append('tenantId', tenantId);

  try {
    const res = await fetch('http://localhost:3000/api/dev/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    console.log("Upload & Ingestion Response:", data);
  } catch (e) {
    console.error("Upload failed (is dev server running on port 3000?):", e.message);
  }
}

run().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
