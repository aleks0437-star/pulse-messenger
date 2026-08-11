-- Store immutable client-validated metadata alongside the object URL.
ALTER TABLE "Message"
ADD COLUMN "mediaType" TEXT,
ADD COLUMN "mediaSize" INTEGER;
