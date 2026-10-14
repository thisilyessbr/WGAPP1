-- Two reviewable offers. Existing plans and assigned snapshots remain untouched.
INSERT INTO "PortalPlan" (id, name, description, price, currency, published, modules, limits, template)
SELECT 'dc22d679-7412-4ce3-a25c-97f9d9a0a8e1', 'Service Assistant',
  'For service businesses: answer FAQs and PDFs, explain services, capture appointment requests and follow up on inquiries. No product catalog or COD.',
  449, 'MAD', false, '["knowledge","services"]'::jsonb,
  '{"messages":2000,"llmCalls":1800,"images":0,"embeddings":600,"monthlyUsd":10,"numbers":1,"products":0,"documents":8,"storageMb":75}'::jsonb,
  '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "PortalPlan" WHERE lower(name) = lower('Service Assistant'));

INSERT INTO "PortalPlan" (id, name, description, price, currency, published, modules, limits, template)
SELECT 'cb9cdb35-9b56-4d36-baa2-45c2330c8e88', 'Sales Assistant',
  'For shops: answer FAQs and PDFs, show products and images, capture purchase requests and optionally configure COD. No service bookings.',
  649, 'MAD', false, '["knowledge","commerce","images"]'::jsonb,
  '{"messages":3000,"llmCalls":2500,"images":100,"embeddings":1000,"monthlyUsd":18,"numbers":1,"products":300,"documents":10,"storageMb":150}'::jsonb,
  '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "PortalPlan" WHERE lower(name) = lower('Sales Assistant'));

-- Align already-published chatbot runtime settings with each assigned plan.
-- The plan snapshot itself, existing leads, and business data are unchanged.
UPDATE "Account" a
SET config = jsonb_set(a.config, '{capabilities,leadMode}',
  to_jsonb((CASE
    WHEN p."planSnapshot"->'modules' ? 'commerce' AND p."planSnapshot"->'modules' ? 'services' THEN 'BOTH'
    WHEN p."planSnapshot"->'modules' ? 'commerce' THEN 'COMMERCE'
    WHEN p."planSnapshot"->'modules' ? 'services' THEN 'SERVICE'
    ELSE 'NONE'
  END)::text), true)
FROM "PortalProfile" p
WHERE p."accountId" = a.id AND p."planSnapshot" IS NOT NULL
  AND a.config IS NOT NULL AND a.config->>'portalManaged' = 'true'
  AND jsonb_typeof(a.config->'capabilities') = 'object';
