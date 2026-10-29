-- AlterTable: extra book fields from the official BookLeaf dataset
ALTER TABLE "Book" ADD COLUMN     "availableOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastPayoutDate" DATE,
ADD COLUMN     "printPartner" TEXT,
ADD COLUMN     "royaltyPerCopy" DECIMAL(10,2);
