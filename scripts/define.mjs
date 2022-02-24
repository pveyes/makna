import { request } from 'undici'
import cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';

function cleanup(text) {
  return text.trim().replace(/\d/g, '').replace(/\//g, '');;
}

async function getDefinitions(word) {
  const res = await request(`https://kbbi.kemdikbud.go.id/entri/${word}`, { headersTimeout: 5e3 })
  const html = await res.body.text();
  const $ = cheerio.load(html);

  if (res.statusCode !== 200) {
    throw new Error('Rate limited');
  }

  const definisi = await Promise.all($('h2[style="margin-bottom:3px"]').toArray().map(async el => {
    const ejaan = cleanup($(el).find('span.syllable').text())
    $(el).find('span.syllable').remove();
    const tidakBaku = cleanup($(el).find('small b').text());
    $(el).find('small').remove();

    let sukuKata = cleanup($(el).text())
    let akarKata = null;
    if (sukuKata.includes('»')) {
      [akarKata, sukuKata] = sukuKata.split('»').map(s => s.trim());
    }

    const $list = $(el).nextAll('ul.adjusted-par, ol').first()
    const $firstResult = $list.find('li').first();
    if ($firstResult.text().includes('→')) {
      const $bentukBaku = $firstResult.find('a')
      const alt = cleanup($bentukBaku.text());
      const [bentukBakuSearch] = $bentukBaku.attr('href').split('/').reverse();
      const definisi = await getDefinitions(bentukBakuSearch);
      return {
        sukuKata,
        akarKata,
        ejaan: ejaan === '' ? sukuKata.replace(/\./g, '') : ejaan,
        baku: false,
        alt,
        makna: definisi[0].makna,
      }
    }

    const makna = [];

    $list.find('li').each((_, el) => {
      const $info = $(el).find('font[color="red"]').first();

      let tipe, tipeTeks, info = [];
      if ($info.length === 1) {
        $info.find('span').each((i, el) => {
          switch (i) {
            case 0: {
              const [type, typeText] = $(el).attr('title').split(':').map(s => s.trim().toLowerCase());
              tipe = type
              tipeTeks = typeText;
              break;
            }
            default: {
              const [source, sourceText] = $(el).attr('title').split(':').map(s => s.trim().toLowerCase());
              info.push({
                sumber: source,
                sumberTeks: sourceText === '-' ? null : sourceText,
              })
              break;
            }
          }
        })
      }

      const contoh = $(el).find('font[color="grey"]:nth-child(3)').text().trim();
      $(el).find("font").remove();
      const definisi = $(el).text().trim().replace(/:$/, '');

      makna.push({
        tipe,
        tipeTeks,
        definisi,
        contoh: contoh === '' ? null : contoh,
        info,
      })
    });

    const $prakategorial = $(el).nextAll('font[color="darkgreen"]').first()
    if (
      $list.length === 0 &&
      $prakategorial.length === 1
    ) {
      const [type, typeText] = $prakategorial.attr('title').split(':').map(s => s.trim().toLowerCase());

      makna.push({
        tipe: type,
        tipeTeks: typeText,
        referensi: $prakategorial.nextAll('font[color="grey"]').first().text().trim().split(',').map(s => s.trim()),
      })
    }

    return {
      sukuKata,
      akarKata,
      ejaan: ejaan === '' ? sukuKata.replace(/\./g, '') : ejaan,
      baku: true,
      alt: tidakBaku || null,
      makna,
    }
  }))

  return definisi
}

async function storeWordDefinition(word, definitions) {
  const storedFilePath = word.replace(/ /g, '_').toLowerCase() + '.json';

  await fs.writeFile(
    path.join(process.cwd(), 'data', storedFilePath),
    JSON.stringify(definitions, null, 2),
  )
}


async function getAllWordsDefinition(lastWord) {
  const res = await request('https://kbbi.vercel.app');
  const { entries } = await res.body.json();
  const words = entries
    .flatMap(entry => {
      const [rawWord] = entry.split("/").reverse();
      const word = decodeURIComponent(rawWord);
      if (word.includes('?')) {
        return []
      }

      return word;
    })

  const startIndex = lastWord ? words.indexOf(lastWord) + 1 : 0;
  const remainingWords = words.slice(startIndex);

  console.log(`Fetching definitions, ${remainingWords.length} words remaining`);
  for await (const word of remainingWords) {
    try {
      const definitions = await getDefinitions(word);
      if (definitions.length === 0) {
        console.warn(`Word ${word} does not exist`);
        continue;
      }

      await storeWordDefinition(word, definitions);
      console.log(`Definition for word ${word} stored`);
    } catch (err) {
      console.error(`Failed to get definitions for ${word}`, { err });
      break;
    }
  }
}

async function getSingleWordDefinition(word) {
  try {
    const definitions = await getDefinitions(word);
    if (definitions.length === 0) {
      console.warn(`Word ${word} does not exist`);
      return;
    }
    await storeWordDefinition(word, definitions);
    console.log(`Definition for word ${word} stored`);
  } catch (err) {
    console.error(`Failed to get definitions for ${word}`, { err });
  }
}

async function getKatlaWordsDefinition(lastWord) {
  const res = await request('https://katla.vercel.app/api/words');
  const words = await res.body.json();

  const startIndex = lastWord ? words.indexOf(lastWord) + 1 : 0;
  const remainingWords = words.slice(startIndex);

  console.log(`Fetching definitions, ${remainingWords.length} words remaining`);
  for await (const word of remainingWords) {
    try {
      const definitions = await getDefinitions(word);
      if (definitions.length === 0) {
        console.warn(`Word ${word} does not exist`);
        continue;
      }

      await storeWordDefinition(word, definitions);
      console.log(`Definition for word ${word} stored`);
    } catch (err) {
      console.error(`Failed to get definitions for ${word}`, { err });
      break;
    }
  }
}

const word = process.argv[2];

switch (word) {
  case 'all': {
    const lastWord = process.argv[3] ?? 0
    getAllWordsDefinition(lastWord);
    break;
  }
  case 'katla': {
    const lastWord = process.argv[3] ?? 0
    getKatlaWordsDefinition(lastWord);
    break;
  }
  default:
    getSingleWordDefinition(word);
}
