// Stored category keys for checklist rows (plan §4.3). Labels: S.labels.*Categories.
export const PACKING_CATEGORIES = ['travel_essentials', 'toiletries', 'everyday_items', 'music_essentials'] as const;
export const TASK_CATEGORIES = ['bookings_documents', 'payments_connectivity', 'before_leaving', 'music_connections'] as const;
export type PackingCategory = (typeof PACKING_CATEGORIES)[number];
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
