import type { ShopReportReason } from '@shared/classifieds';

/** Why a listing or chat is reported, in Udozo's words (the shared labels still name BitoCard Shop in one). */
export const reportReasons: Record<ShopReportReason, string> = {
  scam: 'It looks like a scam',
  prohibited: 'It is not allowed on Udozo',
  wrong_category: 'It is in the wrong category',
  duplicate: 'It is posted more than once',
  sold: 'It has already been sold',
  offensive: 'It is offensive',
  other: 'Something else',
};
