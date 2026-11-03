// Browser-local identity and explicit interests; never credentials or account access.
export const PROFILE_KEY = 'itube.profile.v1';
const controls = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g,' ') : '';
export function validateProfile(raw) {
 const errors = {};
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {ok:false,errors:{profile:'Invalid profile.'}};
 const name = clean(raw.name), handle = typeof raw.handle === 'string' ? raw.handle.trim().replace(/^@/,'').toLowerCase() : '';
 if (raw.name != null && typeof raw.name !== 'string' || typeof raw.name === 'string' && controls.test(raw.name) || name.length > 60) errors.name = 'Use a name of up to 60 characters without control characters.';
 if (raw.handle != null && typeof raw.handle !== 'string' || typeof raw.handle === 'string' && raw.handle.trim() && !/^[a-z0-9_]{1,15}$/.test(handle)) errors.handle = 'Use an X username of 1–15 letters, numbers or underscores, not a URL.';
 const input = typeof raw.topics === 'string' ? raw.topics.split(/[,\n]/) : raw.topics == null ? [] : raw.topics;
 const topics = [], seen = new Set();
 if (!Array.isArray(input)) errors.topics = 'Enter topics separated by commas or new lines.';
 else for (const entry of input) {
  if (typeof entry !== 'string' || controls.test(entry) || clean(entry).length > 60) { errors.topics = 'Each topic must be up to 60 characters without control characters.'; continue; }
  const topic = clean(entry), key = topic.toLowerCase();
  if (topic && !seen.has(key)) {seen.add(key);topics.push(topic);}
 }
 if (topics.length > 12) errors.topics = 'Use at most 12 distinct topics.';
 return {ok:!Object.keys(errors).length,errors,profile:{version:1,name,handle,topics}};
}
export function readProfile(raw) {
 try {if(typeof raw === 'string')raw=JSON.parse(raw);}catch{return {version:1,name:'',handle:'',topics:[]};}
 const result=validateProfile(raw);
 return result.ok ? result.profile : {version:1,name:'',handle:'',topics:[]};
}
export const profileLabel = profile => profile.name ? `For ${profile.name}` : 'For you';
export const canonicalView = view => new Map([['nir','for-you'],['nir-saved','saved-discoveries'],['nir-inbox','inbox']]).get(view) || view;
// Explicit bounded whole-token/phrase matching, not identity-based inference.
export function customTopicBoost(item, profile) {
 const normalize = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const fields=[item.title,item.summary,...(Array.isArray(item.tags)?item.tags:[])].map(normalize);
 let matches=0;
 for(const topic of readProfile(profile).topics){const phrase=normalize(topic);if(phrase && fields.some(field=>` ${field} `.includes(` ${phrase} `)))matches++;}
 return Math.min(matches,3);
}
export function importedProfile(raw, current) {
 if (!Object.hasOwn(raw,'profile')) return readProfile(current);
 const result=validateProfile(raw.profile);
 if(!result.ok)throw Error('Invalid profile in feedback file. '+Object.values(result.errors).join(' '));
 return result.profile;
}
