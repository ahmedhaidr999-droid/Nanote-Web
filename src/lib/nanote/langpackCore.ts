// Language-pack core vocabulary — the backbone every generated offline pack
// is built from (Settings → Languages → Download). English-keyed on purpose:
// the on-device engine pivots through English, so ONE pack per language powers
// every direction it participates in (e.g. FR→AR = FR→EN reverse + EN→AR).
//
// Server-side only: /api/langpack feeds this list to the LLM once per
// language, then caches the result on disk — downloads after the first are
// instant and identical.
//
// Selection criteria: high-frequency everyday + study/academic words, verbs in
// the bare infinitive, nouns in singular, adjectives in the positive form.

export const CORE_WORDS: string[] = [
  // ---------------------------------------------------------------- pronouns & basics
  'I', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'these', 'those',
  'the', 'a', 'an',
  'who', 'what', 'where', 'when', 'why', 'how', 'which', 'whose',
  'here', 'there', 'now', 'today', 'tomorrow', 'yesterday', 'always', 'never', 'often', 'sometimes', 'usually',
  // ---------------------------------------------------------------- essential verbs
  'be', 'am', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does', 'did',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'go', 'come', 'make', 'get', 'give', 'take', 'know', 'think', 'see', 'look', 'want', 'need',
  'find', 'tell', 'ask', 'work', 'seem', 'feel', 'try', 'leave', 'call', 'keep', 'let', 'begin',
  'help', 'talk', 'turn', 'start', 'show', 'hear', 'play', 'run', 'move', 'live', 'believe', 'hold',
  'bring', 'happen', 'write', 'sit', 'stand', 'lose', 'pay', 'meet', 'learn', 'lead', 'read', 'spend',
  'grow', 'open', 'walk', 'win', 'teach', 'offer', 'remember', 'forget', 'consider', 'appear', 'buy', 'sell',
  'wait', 'serve', 'die', 'send', 'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'raise', 'pass',
  'decide', 'return', 'explain', 'hope', 'develop', 'carry', 'receive', 'agree', 'support', 'produce', 'eat', 'drink',
  'sleep', 'speak', 'choose', 'change', 'watch', 'catch', 'close', 'open', 'answer', 'share', 'compare', 'add',
  'remove', 'use', 'apply', 'create', 'save', 'search', 'check', 'follow', 'travel', 'visit', 'study', 'review',
  'understand', 'mean', 'prefer', 'prepare', 'report', 'result', 'increase', 'decrease', 'continue', 'stop', 'finish', 'complete',
  // high-frequency irregular past forms (stemming cannot recover these)
  'said', 'made', 'put', 'got', 'went', 'came', 'saw', 'seen', 'knew', 'known', 'took', 'given', 'gave',
  'found', 'thought', 'told', 'felt', 'left', 'began', 'begun', 'kept', 'held', 'met', 'paid', 'spent',
  'grew', 'won', 'lost', 'sent', 'built', 'sat', 'stood', 'chose', 'chosen', 'meant', 'set', 'ran', 'ate',
  'slept', 'spoke', 'fallen', 'fell', 'written', 'wrote', 'driven', 'broke', 'broken', 'brought', 'bought', 'sold',
  // everyday actions
  'say', 'like', 'hate', 'die', 'live', 'listen', 'cook', 'drive', 'ride', 'fly', 'swim', 'sing', 'dance',
  'draw', 'paint', 'wash', 'allow', 'require', 'remain', 'represent', 'read', 'write',
  // ---------------------------------------------------------------- time & numbers
  'time', 'year', 'month', 'week', 'day', 'hour', 'minute', 'second', 'moment', 'period', 'future', 'past',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'morning', 'evening', 'night', 'noon', 'date', 'century', 'holiday', 'summer', 'winter', 'spring', 'autumn', 'season',
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'hundred',
  'thousand', 'million', 'first', 'half', 'quarter', 'number', 'count', 'order', 'times', 'part',
  // ---------------------------------------------------------------- people & society
  'person', 'people', 'man', 'woman', 'child', 'children', 'boy', 'girl', 'family', 'mother', 'father', 'parent',
  'brother', 'sister', 'son', 'daughter', 'friend', 'husband', 'wife', 'baby', 'name', 'age', 'life', 'death',
  'student', 'teacher', 'doctor', 'nurse', 'patient', 'engineer', 'worker', 'manager', 'leader', 'king', 'queen', 'president',
  'government', 'country', 'city', 'town', 'village', 'state', 'nation', 'world', 'earth', 'land', 'sea', 'ocean',
  'river', 'mountain', 'desert', 'forest', 'tree', 'flower', 'sky', 'sun', 'moon', 'star', 'water', 'fire',
  'air', 'weather', 'rain', 'snow', 'wind', 'cloud', 'light', 'dark', 'animal', 'bird', 'fish', 'horse',
  // ---------------------------------------------------------------- body & health
  'head', 'face', 'eye', 'ear', 'nose', 'mouth', 'tooth', 'hand', 'finger', 'arm', 'leg', 'foot',
  'heart', 'blood', 'body', 'mind', 'brain', 'health', 'sick', 'illness', 'pain', 'medicine', 'hospital', 'pharmacy',
  'dog', 'cat', 'thing', 'things', 'something', 'nothing', 'everything', 'someone', 'anyone',
  'food', 'bread', 'rice', 'meat', 'chicken', 'fish', 'egg', 'milk', 'cheese', 'fruit', 'vegetable', 'apple',
  'water', 'tea', 'coffee', 'juice', 'sugar', 'salt', 'oil', 'breakfast', 'lunch', 'dinner', 'meal', 'restaurant',
  // ---------------------------------------------------------------- home & things
  'house', 'home', 'room', 'kitchen', 'bathroom', 'bedroom', 'door', 'window', 'wall', 'floor', 'roof', 'garden',
  'table', 'chair', 'bed', 'book', 'pen', 'pencil', 'paper', 'page', 'letter', 'word', 'sentence', 'question',
  'answer', 'key', 'money', 'price', 'market', 'shop', 'store', 'gift', 'box', 'bag', 'clock', 'watch',
  'phone', 'computer', 'screen', 'keyboard', 'mouse', 'camera', 'car', 'bus', 'train', 'plane', 'ship', 'bicycle',
  'road', 'street', 'bridge', 'airport', 'station', 'ticket', 'trip', 'map', 'address', 'place', 'space', 'corner',
  'clothes', 'shirt', 'dress', 'shoe', 'hat', 'coat', 'pocket', 'pair', 'tool', 'machine', 'engine', 'part',
  'light', 'lamp', 'candle', 'mirror', 'picture', 'photo', 'image', 'music', 'song', 'radio', 'television', 'news',
  // ---------------------------------------------------------------- school & work
  'school', 'university', 'college', 'class', 'classroom', 'lesson', 'course', 'subject', 'exam', 'test', 'homework', 'library',
  'science', 'math', 'history', 'geography', 'chemistry', 'physics', 'biology', 'language', 'Arabic', 'English', 'grammar', 'literature',
  'word', 'reading', 'writing', 'speaking', 'listening', 'translation', 'dictionary', 'example', 'note', 'notebook', 'report', 'research',
  'office', 'company', 'job', 'work', 'business', 'meeting', 'project', 'plan', 'idea', 'goal', 'success', 'failure',
  'team', 'group', 'member', 'member', 'task', 'duty', 'role', 'skill', 'experience', 'practice', 'training', 'course',
  // ---------------------------------------------------------------- qualities & describing
  'good', 'bad', 'big', 'small', 'large', 'little', 'long', 'short', 'high', 'low', 'tall',
  'new', 'old', 'young', 'early', 'late', 'fast', 'quick', 'slow', 'hot', 'cold', 'warm', 'cool',
  'easy', 'difficult', 'hard', 'soft', 'strong', 'weak', 'heavy', 'light', 'right', 'wrong', 'true', 'false',
  'beautiful', 'ugly', 'clean', 'dirty', 'full', 'empty', 'open', 'closed', 'near', 'far', 'same', 'different',
  'important', 'possible', 'impossible', 'necessary', 'useful', 'useless', 'common', 'rare', 'safe', 'dangerous', 'rich', 'poor',
  'happy', 'sad', 'angry', 'afraid', 'brave', 'calm', 'busy', 'free', 'sure', 'ready', 'tired', 'sick',
  'best', 'better', 'worst', 'worse', 'more', 'less', 'most', 'least', 'many', 'much', 'few', 'several',
  'all', 'some', 'any', 'no', 'every', 'each', 'both', 'either', 'other', 'another', 'such', 'own',
  // colors
  'red', 'blue', 'green', 'black', 'white', 'yellow', 'brown', 'gray', 'grey', 'orange', 'pink', 'purple',
  'loud', 'quiet', 'dry', 'wet', 'sweet', 'bitter', 'sour', 'salty', 'famous', 'correct', 'top', 'bottom',
  // ---------------------------------------------------------------- abstract & academic
  'way', 'method', 'system', 'process', 'result', 'effect', 'cause', 'reason', 'problem', 'solution', 'example', 'instance',
  'fact', 'truth', 'case', 'point', 'level', 'degree', 'kind', 'type', 'form', 'shape', 'size', 'color',
  'quality', 'quantity', 'value', 'amount', 'unit', 'measure', 'rule', 'law', 'right', 'duty', 'order', 'peace',
  'war', 'power', 'force', 'energy', 'matter', 'object', 'element', 'nature', 'natural', 'human', 'social', 'culture',
  'art', 'religion', 'faith', 'hope', 'love', 'fear', 'dream', 'wish', 'luck', 'chance', 'choice', 'decision',
  'information', 'data', 'knowledge', 'wisdom', 'meaning', 'purpose', 'theory', 'definition', 'concept', 'evidence', 'proof', 'argument',
  'story', 'story', 'novel', 'poem', 'poetry', 'author', 'writer', 'reader', 'message', 'letter', 'conversation', 'dialogue',
  'beginning', 'end', 'middle', 'side', 'direction', 'north', 'south', 'east', 'west', 'inside', 'outside', 'above',
  'below', 'front', 'back', 'left', 'right', 'center', 'edge', 'line', 'circle', 'square', 'angle', 'surface',
  // ---------------------------------------------------------------- function words
  'and', 'or', 'but', 'so', 'because', 'if', 'then', 'else', 'when', 'while', 'before', 'after',
  'during', 'until', 'since', 'for', 'about', 'against', 'between', 'through', 'under', 'over', 'again', 'also',
  'very', 'too', 'quite', 'really', 'almost', 'already', 'still', 'yet', 'just', 'only', 'even', 'however',
  'although', 'though', 'whether', 'therefore', 'thus', 'meanwhile', 'moreover', 'besides', 'instead', 'perhaps', 'maybe', 'probably',
  'certainly', 'of', 'to', 'in', 'on', 'at', 'with', 'without', 'from', 'by', 'as', 'like',
  'up', 'down', 'out', 'off', 'into', 'onto', 'toward', 'away', 'back', 'forward', 'together', 'apart',
  'yes', 'no', 'not', 'please', 'thank you', 'hello', 'goodbye', 'welcome', 'sorry', 'excuse me', 'ok', 'okay',
];

export const CORE_PHRASES: string[] = [
  'good morning', 'good evening', 'good night', 'see you later', 'how are you', 'I am fine',
  'nice to meet you', 'what is your name', 'my name is', 'where are you from', 'how old are you',
  'I do not know', 'I do not understand', 'can you help me', 'of course', 'no problem',
  'thank you very much', 'you are welcome', 'excuse me', 'I am sorry', 'it does not matter',
  'for example', 'in general', 'as usual', 'at the moment', 'right now', 'a little',
  'a lot', 'too much', 'more or less', 'at least', 'at first', 'finally',
  'in fact', 'actually', 'in other words', 'by the way', 'on the other hand', 'as well',
  'good luck', 'take care', 'be careful', 'hurry up', 'wait a moment', 'come here',
  'go away', 'sit down', 'stand up', 'speak slowly', 'repeat please', 'what does it mean',
  'how do you say', 'I would like', 'I want to', 'I have to', 'I must go', 'see you tomorrow',
  'long time no see', 'have a nice day', 'happy birthday', 'merry Christmas', 'happy new year', 'congratulations',
  'how much is it', 'too expensive', 'it is cheap', 'I am hungry', 'I am thirsty', 'I am tired',
  'I am sick', 'get well soon', 'take care of yourself', 'do not worry', 'be patient', 'pay attention',
  'open the door', 'close the window', 'turn on the light', 'turn off the light', 'write it down', 'take notes',
  'do your homework', 'study hard', 'practice makes perfect', 'knowledge is light', 'time is money', 'better late than never',
  'actions speak louder than words', 'the more you read the more you learn', 'a picture is worth a thousand words',
  'in my opinion', 'according to', 'as far as I know', 'to be honest', 'it depends', 'that is true',
  'that is false', 'I agree', 'I disagree', 'let us begin', 'let us continue', 'in short',
];

/** Deduplicated + sorted source list (generated packs cache keyed on its hash). */
export function coreVocabulary(): { words: string[]; phrases: string[] } {
  const words = [...new Set(CORE_WORDS.map((w) => w.trim().toLowerCase()).filter(Boolean))].sort();
  const phrases = [...new Set(CORE_PHRASES.map((p) => p.trim().toLowerCase()).filter(Boolean))].sort();
  return { words, phrases };
}
