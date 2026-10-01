/**
 * Profile prompt catalogue (guide M08). The prompts seeder upserts by text:
 * category and order follow this list; is_active is set only on insert.
 * Changing a prompt's text adds a new prompt; retire the old one with
 * is_active = false (profiles that answered it keep the answer).
 */
export interface PromptSeed {
  text: string;
  category: string;
}

const group = (category: string, texts: string[]): PromptSeed[] => texts.map((text) => ({ text, category }));

export const PROMPT_SEED: ReadonlyArray<PromptSeed> = [
  ...group('about_me', [
    'My perfect Sunday is…',
    'I am happiest when…',
    'A random fact I love is…',
    'My friends would describe me as…',
    'The way to win me over is…',
  ]),
  ...group('food', [
    'The best street food I have ever had…',
    'My go-to chai order is…',
    'I could eat this every day…',
  ]),
  ...group('travel', [
    'The next place on my travel list is…',
    'My most spontaneous trip was…',
    'A place that feels like home…',
  ]),
  ...group('dating', [
    'I am looking for someone who…',
    'A green flag for me is…',
    'Our first date could be…',
    'We will get along if…',
  ]),
  ...group('fun', [
    'My hidden talent is…',
    'The song I always sing along to…',
    'A movie I can watch again and again…',
    'My weekend usually looks like…',
    'I will never say no to…',
  ]),
];
