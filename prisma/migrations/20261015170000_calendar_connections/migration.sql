-- Google Calendar linked by the client from their portal (one per account).
-- The refresh token is stored encrypted (SecretBox, AES-256-GCM); it never appears in the account config.
CREATE TABLE IF NOT EXISTS "CalendarConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "googleEmail" TEXT,
    "encryptedRefreshToken" TEXT NOT NULL,
    "calendarId" TEXT,
    "calendarName" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarConnection_accountId_key" ON "CalendarConnection"("accountId");
CREATE INDEX IF NOT EXISTS "CalendarConnection_tenantId_idx" ON "CalendarConnection"("tenantId");

-- Relayqo's built-in calendar: each account's availability, and the bookings the chatbot (or the team) makes.
CREATE TABLE IF NOT EXISTS "AccountCalendar" (
    "accountId" TEXT NOT NULL PRIMARY KEY REFERENCES "Account"("id") ON DELETE CASCADE,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BOOKING',
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "title" TEXT NOT NULL,
    "customerName" TEXT,
    "contact" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Two customers can never hold the same start time: the second insert fails atomically.
CREATE UNIQUE INDEX IF NOT EXISTS "Booking_accountId_startAt_active_key" ON "Booking"("accountId", "startAt") WHERE "status" = 'BOOKED';
CREATE INDEX IF NOT EXISTS "Booking_accountId_startAt_idx" ON "Booking"("accountId", "startAt");
