/**
 * The kid thinking out loud while things happen, and Mom calling from the
 * kitchen. Personality, not instruction: none of it is a hint, and none of it
 * ever calls a test a failure.
 */
export type KidCue = 'go' | 'ignite' | 'break' | 'crash' | 'fast' | 'fly' | 'brownout' | 'bounce' | 'pet' | 'dogBark' | 'success';
export type MomCue = 'crash' | 'ignite' | 'success' | 'book';

export const KID_LINES: Record<KidCue, string[]> = {
  go: ['Here goes nothing…', 'Okay okay okay. GO!', 'Come on, come on…', 'Test number… I lost count. GO!', 'Please work please work please work.'],
  ignite: ['3… 2… WHOA!', 'FIRE IN THE HOLE!', 'That is LOUD.', 'Ooh, it’s going!'],
  break: ['That piece was NOT supposed to come off.', 'Uh. Where did that part go?', 'Note to self: more tape.', 'Huh. So THAT’s the weak spot.', 'It’s fine. Parts are just suggestions.'],
  crash: ['OOF.', 'Ow. For the machine, I mean.', 'Nobody saw that. …Biscuit saw that.', 'KA-BLAM. Okay. Data!'],
  fast: ['Look at it GO!', 'Whoa whoa WHOA!', 'Fast. Too fast? Just fast enough?', 'Zoom!'],
  fly: ['It’s FLYING!', 'Up, up… and…', 'Is it supposed to go that high?', 'Look at that air!'],
  brownout: ['Come on, battery…', 'It’s running out of juice.', 'Sounds tired. Needs more power?'],
  bounce: ['Boing.', 'Ha! Bouncy.', 'Sproing!'],
  pet: ['Good boy, Biscuit.', 'Who’s my lab assistant? You are!', 'Biscuit approves of this project.', 'Okay, okay, I love you too.', 'Best dog. Best engineer’s dog.'],
  dogBark: ['Not now, Biscuit, I’m doing science.', 'Biscuit thinks it’s a toy.', 'Biscuit, that’s my machine!', 'Yes, Biscuit, I see it too.'],
  success: ['YESSS!', 'IT WORKED! IT ACTUALLY WORKED!', 'I am a GENIUS. Also a little lucky.', 'Did everybody see that?!'],
};

export const MOM_LINES: Record<MomCue, string[]> = {
  crash: ['Everything okay out there?!', 'What was THAT?', 'Is anything on fire?', 'That sounded expensive!'],
  ignite: ['Was that a ROCKET?!', 'Safety glasses, please!', 'Stand BACK from that thing!'],
  success: ['That’s my kid! 💛', 'Ooh, nice one!', 'I saw that! Very clever.', 'Now THAT is engineering.'],
  book: ['Oh! You found my old textbook. Careful, it’s older than you.'],
};

/** Picks a line for a cue, never the same one twice in a row. */
export class LinePicker<C extends string> {
  private last = new Map<C, string>();
  constructor(private lines: Record<C, string[]>, private rand = Math.random) {}
  pick(cue: C): string {
    const all = this.lines[cue];
    const options = all.length > 1 ? all.filter((l) => l !== this.last.get(cue)) : all;
    const line = options[Math.floor(this.rand() * options.length) % options.length];
    this.last.set(cue, line);
    return line;
  }
}
