-- Create expenses_invoices table to store GOBL Invoice JSON for expense tickets
CREATE TABLE IF NOT EXISTS expenses_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    source_image_url TEXT NOT NULL,
    gobl_invoice JSONB NOT NULL,
    raw_ocr JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for faster lookup
CREATE INDEX IF NOT EXISTS idx_expenses_invoices_profile_id ON expenses_invoices(profile_id);
CREATE INDEX IF NOT EXISTS idx_expenses_invoices_created_at ON expenses_invoices(created_at);

