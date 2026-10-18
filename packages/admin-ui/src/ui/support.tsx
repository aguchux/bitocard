/** Support ticket labels shared by the admin app and SHQ. */
export const ticketCategoryLabels: Record<string, string> = { order: 'An order', payment: 'A payment', account: 'Account', product: 'A product', technical: 'Technical', other: 'Other' };
export const ticketPriorityLabels: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const ticketSourceLabels: Record<string, string> = { form: 'Form', api: 'API', chat: 'Chat', bot: 'Assistant' };

/** Whose turn a ticket is, as the side answering it reads it. */
export function ticketStatusLabel(status: string, answering: boolean) {
  if (status === 'resolved') return 'Resolved';
  if (status === 'pending') return answering ? 'Waiting for the requester' : 'Waiting for you';
  return answering ? 'Needs an answer' : 'Waiting for an answer';
}
