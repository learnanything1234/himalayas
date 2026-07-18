// Maps student-facing subject names to the official DfE transition-matrix
// subject names. The DfE uses idiosyncratic labels (e.g. "Business
// Studies:Single", "Computer Studies / Computing", "Logic / Philosophy"),
// so we normalise aggressively and keep an alias table for the common
// student-facing spellings.

// alias (lower-cased, punctuation-stripped) -> canonical DfE subject name
export const SUBJECT_ALIASES = {
  'maths': 'Mathematics',
  'math': 'Mathematics',
  'mathematics': 'Mathematics',
  'further maths': 'Mathematics (Further)',
  'further mathematics': 'Mathematics (Further)',
  'stats': 'Mathematics (Statistics)',
  'statistics': 'Mathematics (Statistics)',
  'comp sci': 'Computer Studies / Computing',
  'computer science': 'Computer Studies / Computing',
  'computing': 'Computer Studies / Computing',
  'computer studies': 'Computer Studies / Computing',
  'cs': 'Computer Studies / Computing',
  'business': 'Business Studies:Single',
  'business studies': 'Business Studies:Single',
  'econ': 'Economics',
  'economics': 'Economics',
  'pe': 'Physical Education / Sports Studies',
  'physical education': 'Physical Education / Sports Studies',
  'sport': 'Physical Education / Sports Studies',
  'sports studies': 'Physical Education / Sports Studies',
  'politics': 'Government and Politics',
  'government and politics': 'Government and Politics',
  'gov and politics': 'Government and Politics',
  'rs': 'Religious Studies',
  're': 'Religious Studies',
  'religious education': 'Religious Studies',
  'religious studies': 'Religious Studies',
  'philosophy': 'Logic / Philosophy',
  'logic': 'Logic / Philosophy',
  'media': 'Media/Film/Tv Studies',
  'media studies': 'Media/Film/Tv Studies',
  'film': 'Film Studies',
  'film studies': 'Film Studies',
  'drama': 'Drama and Theatre Studies',
  'theatre studies': 'Drama and Theatre Studies',
  'english': 'English Literature',
  'english lit': 'English Literature',
  'english literature': 'English Literature',
  'english lang': 'English Language',
  'english language': 'English Language',
  'english language and literature': 'English Language and Literature',
  'dt': 'Design and Technology (Product Design)',
  'product design': 'Design and Technology (Product Design)',
  'design and technology': 'Design and Technology (Product Design)',
  'design technology': 'Design and Technology (Product Design)',
  'textiles': 'Design and Technology (Textiles Technology)',
  'engineering': 'Design and Technology (Engineering)',
  'art': 'Art and Design',
  'art design': 'Art and Design',
  'art and design': 'Art and Design',
  'fine art': 'Art and Design (Fine Art)',
  'photography': 'Art and Design (Photography)',
  'graphics': 'Art and Design (Graphics)',
  'bio': 'Biology',
  'biology': 'Biology',
  'chem': 'Chemistry',
  'chemistry': 'Chemistry',
  'physics': 'Physics',
  'geog': 'Geography',
  'geography': 'Geography',
  'history': 'History',
  'psych': 'Psychology',
  'psychology': 'Psychology',
  'sociology': 'Sociology',
  'law': 'Law',
  'accounting': 'Accounting / Finance',
  'finance': 'Accounting / Finance',
  'music': 'Music',
  'music tech': 'Music Technology',
  'french': 'French',
  'spanish': 'Spanish',
  'german': 'German',
  'classical civilisation': 'Classical Civilisation',
  'classics': 'Classical Civilisation',
  'latin': 'Latin',
  'environmental science': 'Environmental Science',
  'geology': 'Geology',
  'electronics': 'Electronics',
  'dance': 'Dance',
};

// Clean, student-facing display names for the DfE's more awkward labels.
// Anything not listed is already presentable and used as-is.
export const SUBJECT_DISPLAY_NAMES = {
  'Business Studies:Single': 'Business Studies',
  'Computer Studies / Computing': 'Computer Science',
  'Media/Film/Tv Studies': 'Media Studies',
  'Logic / Philosophy': 'Philosophy',
  'Mathematics (Further)': 'Further Mathematics',
  'Mathematics (Statistics)': 'Statistics',
  'Physical Education / Sports Studies': 'Physical Education',
  'Accounting / Finance': 'Accounting & Finance',
  'Government and Politics': 'Politics',
  'Drama and Theatre Studies': 'Drama & Theatre Studies',
  'Design and Technology (Engineering)': 'Design & Technology (Engineering)',
  'Design and Technology (Product Design)': 'Design & Technology (Product Design)',
  'Design and Technology (Textiles Technology)': 'Design & Technology (Textiles)',
  'English Language and Literature': 'English Language & Literature',
};

export function displayName(canonical) {
  return SUBJECT_DISPLAY_NAMES[canonical] || canonical;
}

function normalise(s) {
  return String(s)
    .toLowerCase()
    .replace(/a[- ]?levels?/g, '')     // strip "A-level" / "A level"
    .replace(/[._/:]/g, ' ')
    .replace(/[^a-z0-9() ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Resolve a user-supplied subject name to a canonical DfE subject name.
// `known` is the Set of canonical names present in the DB. Returns
// { subject, matched } or { subject: null } if unresolved.
export function resolveSubject(input, known) {
  if (!input) return { subject: null, input };
  const raw = String(input).trim();

  // 1. exact match against canonical DfE names
  if (known.has(raw)) return { subject: raw, input, method: 'exact' };

  const norm = normalise(raw);

  // 2. alias table
  if (SUBJECT_ALIASES[norm]) {
    return { subject: SUBJECT_ALIASES[norm], input, method: 'alias' };
  }

  // 3. normalised match against canonical names
  for (const name of known) {
    if (normalise(name) === norm) return { subject: name, input, method: 'normalised' };
  }

  // 4. loose contains match (e.g. "computer" -> "Computer Studies / Computing")
  const hits = [...known].filter((name) => {
    const nn = normalise(name);
    return nn.includes(norm) || norm.includes(nn);
  });
  if (hits.length === 1) return { subject: hits[0], input, method: 'fuzzy' };

  return { subject: null, input, candidates: hits.slice(0, 5) };
}
