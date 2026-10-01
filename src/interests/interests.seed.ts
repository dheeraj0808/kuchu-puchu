/**
 * Interest catalogue (guide M08). The interests seeder upserts by slug:
 * name, category, icon and order follow this list on every run; is_active is
 * set only when a row is inserted, so an interest an admin retired stays
 * retired. Never remove an entry: retire it with is_active = false.
 * Icons are names from the app's icon set.
 */
export interface InterestSeed {
  name: string;
  slug: string;
  category: string;
  icon: string;
}

const group = (category: string, items: Array<[name: string, slug: string, icon: string]>): InterestSeed[] =>
  items.map(([name, slug, icon]) => ({ name, slug, category, icon }));

export const INTEREST_SEED: ReadonlyArray<InterestSeed> = [
  ...group('lifestyle', [
    ['Travel', 'travel', 'plane'],
    ['Food', 'food', 'utensils'],
    ['Cooking', 'cooking', 'chef-hat'],
    ['Fitness', 'fitness', 'dumbbell'],
    ['Yoga', 'yoga', 'flower'],
    ['Pets', 'pets', 'paw'],
  ]),
  ...group('arts', [
    ['Music', 'music', 'music'],
    ['Movies', 'movies', 'clapperboard'],
    ['Books', 'books', 'book'],
    ['Reading', 'reading', 'book-open'],
    ['Art', 'art', 'palette'],
    ['Photography', 'photography', 'camera'],
    ['Dance', 'dance', 'music-2'],
  ]),
  ...group('sports', [
    ['Sports', 'sports', 'trophy'],
    ['Cricket', 'cricket', 'cricket'],
    ['Football', 'football', 'football'],
    ['Badminton', 'badminton', 'feather'],
    ['Running', 'running', 'footprints'],
  ]),
  ...group('outdoors', [
    ['Nature', 'nature', 'leaf'],
    ['Trekking', 'trekking', 'mountain'],
    ['Beaches', 'beaches', 'umbrella'],
  ]),
  ...group('tech', [
    ['Technology', 'technology', 'cpu'],
    ['Gaming', 'gaming', 'gamepad'],
    ['Business', 'business', 'briefcase'],
    ['Startups', 'startups', 'rocket'],
  ]),
];
