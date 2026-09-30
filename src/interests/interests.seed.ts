/**
 * Initial interest catalogue. Edit freely: the seed migration inserts any slug
 * that does not exist yet and never overwrites or deletes existing rows.
 * To retire an interest, set is_active = false rather than removing it.
 */
export const INTEREST_SEED: ReadonlyArray<{ name: string; slug: string }> = [
  { name: 'Music', slug: 'music' },
  { name: 'Travel', slug: 'travel' },
  { name: 'Fitness', slug: 'fitness' },
  { name: 'Movies', slug: 'movies' },
  { name: 'Books', slug: 'books' },
  { name: 'Gaming', slug: 'gaming' },
  { name: 'Food', slug: 'food' },
  { name: 'Photography', slug: 'photography' },
  { name: 'Sports', slug: 'sports' },
  { name: 'Art', slug: 'art' },
  { name: 'Technology', slug: 'technology' },
  { name: 'Business', slug: 'business' },
  { name: 'Nature', slug: 'nature' },
  { name: 'Cooking', slug: 'cooking' },
  { name: 'Reading', slug: 'reading' },
];
