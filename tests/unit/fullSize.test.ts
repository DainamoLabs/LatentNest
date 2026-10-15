import { describe, expect, it } from 'vitest';
import { fullSizeUrls } from '@/lib/fullSize';

// These pin each site's address pattern. When a site changes its URLs, the
// rule stops matching and only the shown copy is saved, without an error, so
// a failure here is the only warning.

describe('X/Twitter', () => {
  it('asks for the original in the format shown, then the large sizes', () => {
    const url = 'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=jpg&name=small';
    expect(fullSizeUrls(url)).toEqual([
      'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=jpg&name=orig',
      'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=jpg&name=4096x4096',
      'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=jpg&name=large',
      url,
    ]);
  });

  it('tries both upload formats for a WebP copy', () => {
    const url = 'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=webp&name=900x900';
    expect(fullSizeUrls(url)).toEqual([
      'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=jpg&name=orig',
      'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=png&name=orig',
      'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=jpg&name=4096x4096',
      'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=jpg&name=large',
      url,
    ]);
  });

  it('reads old-style addresses and "jpeg"', () => {
    expect(fullSizeUrls('https://pbs.twimg.com/media/CkAbc123.png:large')[0]).toBe(
      'https://pbs.twimg.com/media/CkAbc123?format=png&name=orig',
    );
    expect(fullSizeUrls('https://pbs.twimg.com/media/CkAbc123?format=jpeg&name=small')[0]).toBe(
      'https://pbs.twimg.com/media/CkAbc123?format=jpg&name=orig',
    );
  });

  it('covers video thumbnails', () => {
    expect(fullSizeUrls('https://pbs.twimg.com/ext_tw_video_thumb/1234567890/pu/img/AbC-dEf.jpg')[0]).toBe(
      'https://pbs.twimg.com/ext_tw_video_thumb/1234567890/pu/img/AbC-dEf?format=jpg&name=orig',
    );
  });

  it('leaves profile pictures and the original itself alone', () => {
    const avatar = 'https://pbs.twimg.com/profile_images/1234567890/AbCdEf_400x400.jpg';
    expect(fullSizeUrls(avatar)).toEqual([avatar]);
    const orig = 'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=jpg&name=orig';
    expect(fullSizeUrls(orig)).toEqual([
      orig,
      'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=jpg&name=4096x4096',
      'https://pbs.twimg.com/media/GZx1aBcWkAA7xYz?format=jpg&name=large',
    ]);
  });
});

describe('Pinterest', () => {
  const hash = '0f/1e/2d/0f1e2d3c4b5a69788796a5b4c3d2e1f0';

  it('tries the original in each format, then the 1200px copy', () => {
    const url = `https://i.pinimg.com/736x/${hash}.jpg`;
    expect(fullSizeUrls(url)).toEqual([
      `https://i.pinimg.com/originals/${hash}.jpg`,
      `https://i.pinimg.com/originals/${hash}.png`,
      `https://i.pinimg.com/originals/${hash}.webp`,
      `https://i.pinimg.com/originals/${hash}.gif`,
      `https://i.pinimg.com/1200x/${hash}.jpg`,
      url,
    ]);
  });

  it('tries GIF first for a GIF and reads square crops', () => {
    expect(fullSizeUrls(`https://i.pinimg.com/236x/${hash}.gif`)[0]).toBe(`https://i.pinimg.com/originals/${hash}.gif`);
    expect(fullSizeUrls(`https://i.pinimg.com/75x75_RS/${hash}.jpg`)[0]).toBe(`https://i.pinimg.com/originals/${hash}.jpg`);
  });

  it('leaves originals and avatars alone', () => {
    const orig = `https://i.pinimg.com/originals/${hash}.png`;
    expect(fullSizeUrls(orig)).toEqual([orig]);
    const avatar = 'https://i.pinimg.com/75x75_RS/ab/cd/ef/user.jpg';
    expect(fullSizeUrls(avatar)).toEqual([avatar]);
  });
});

describe('Reddit', () => {
  it('maps previews to i.redd.it, keeping the extension as written', () => {
    const url = 'https://preview.redd.it/my-cat-in-the-sun-v0-k3xq9z1a2b3c4.jpeg?width=640&crop=smart&auto=webp&s=abc';
    expect(fullSizeUrls(url)).toEqual(['https://i.redd.it/k3xq9z1a2b3c4.jpeg', url]);
    expect(fullSizeUrls('https://preview.redd.it/k3xq9z1a2b3c4.png?width=320')[0]).toBe('https://i.redd.it/k3xq9z1a2b3c4.png');
  });

  it('leaves external previews alone', () => {
    const url = 'https://external-preview.redd.it/AbC_dEf.jpg?auto=webp';
    expect(fullSizeUrls(url)).toEqual([url]);
  });
});

describe('Wikimedia', () => {
  it('maps thumbnails to the original file', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Red_fox_in_snow.jpg/960px-Red_fox_in_snow.jpg';
    expect(fullSizeUrls(url)).toEqual(['https://upload.wikimedia.org/wikipedia/commons/a/ab/Red_fox_in_snow.jpg', url]);
  });

  it('handles archived versions and the thumb host', () => {
    expect(
      fullSizeUrls('https://upload.wikimedia.org/wikipedia/commons/thumb/archive/a/ab/20200101000000!Fox.png/120px-Fox.png')[0],
    ).toBe('https://upload.wikimedia.org/wikipedia/commons/archive/a/ab/20200101000000!Fox.png');
    expect(fullSizeUrls('https://thumb.wikimedia.org/wikipedia/en/thumb/1/1f/Fox.jpg/220px-Fox.jpg')[0]).toBe(
      'https://upload.wikimedia.org/wikipedia/en/1/1f/Fox.jpg',
    );
  });

  it('leaves SVG and PDF thumbnails alone', () => {
    const svg = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Logo.svg/120px-Logo.svg.png';
    expect(fullSizeUrls(svg)).toEqual([svg]);
    const pdf = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Book.pdf/page1-120px-Book.pdf.jpg';
    expect(fullSizeUrls(pdf)).toEqual([pdf]);
  });
});

describe('Bluesky', () => {
  it('asks the account server for the blob, then the full-size copy', () => {
    const url = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreigh2akiscaildc@jpeg';
    expect(fullSizeUrls(url)).toEqual([
      'https://bsky.social/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Az72i7hdynmk6r22z27h6tvur&cid=bafkreigh2akiscaildc',
      'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreigh2akiscaildc@jpeg',
      url,
    ]);
  });

  it('leaves avatars alone', () => {
    const url = 'https://cdn.bsky.app/img/avatar/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreigh2akiscaildc@jpeg';
    expect(fullSizeUrls(url)).toEqual([url]);
  });
});

describe('Mastodon', () => {
  it('maps small to original on any server, including cached remote media', () => {
    const url = 'https://files.mastodon.social/media_attachments/files/113/284/917/201/938/123/small/1a2b3c4d5e6f7a8b.jpg';
    expect(fullSizeUrls(url)).toEqual([
      'https://files.mastodon.social/media_attachments/files/113/284/917/201/938/123/original/1a2b3c4d5e6f7a8b.jpg',
      url,
    ]);
    expect(fullSizeUrls('https://example.social/system/cache/media_attachments/files/113/284/small/0abc.png')[0]).toBe(
      'https://example.social/system/cache/media_attachments/files/113/284/original/0abc.png',
    );
  });

  it('leaves avatars alone', () => {
    const url = 'https://files.mastodon.social/accounts/avatars/000/000/001/original/abc.jpg';
    expect(fullSizeUrls(url)).toEqual([url]);
  });
});

describe('Danbooru', () => {
  const md5 = '0123456789abcdef0123456789abcdef';
  const originals = ['jpg', 'png', 'webp', 'gif', 'avif'].map((f) => `https://cdn.donmai.us/original/01/23/${md5}.${f}`);

  it('tries the original in each format, then the sample', () => {
    const url = `https://cdn.donmai.us/360x360/01/23/${md5}.webp`;
    expect(fullSizeUrls(url)).toEqual([...originals, `https://cdn.donmai.us/sample/01/23/sample-${md5}.jpg`, url]);
  });

  it('does not offer a sample for a sample', () => {
    const url = `https://cdn.donmai.us/sample/01/23/sample-${md5}.jpg`;
    expect(fullSizeUrls(url)).toEqual([...originals, url]);
  });
});

describe('ArtStation', () => {
  it('tries 8k, 4k and large, dropping the square crop folder', () => {
    const url =
      'https://cdnb.artstation.com/p/assets/images/images/012/345/678/20180301012345/smaller_square/jane-doe-forest.jpg?1519900000';
    const base = 'https://cdnb.artstation.com/p/assets/images/images/012/345/678';
    expect(fullSizeUrls(url)).toEqual([`${base}/8k/jane-doe-forest.jpg`, `${base}/4k/jane-doe-forest.jpg`, `${base}/large/jane-doe-forest.jpg`, url]);
    expect(fullSizeUrls('https://cdn.artstation.com/p/assets/images/images/012/345/678/medium/x.png')[0]).toBe(
      'https://cdn.artstation.com/p/assets/images/images/012/345/678/8k/x.png',
    );
  });

  it('leaves avatars alone', () => {
    const url = 'https://cdna.artstation.com/p/users/avatars/000/123/456/medium/abc.jpg';
    expect(fullSizeUrls(url)).toEqual([url]);
  });
});

describe('Tumblr', () => {
  it('maps old sizes to _1280', () => {
    const url = 'https://66.media.tumblr.com/0123456789abcdef0123456789abcdef/tumblr_p1a2b3C4d5E6f7g8o1_500.jpg';
    expect(fullSizeUrls(url)).toEqual([
      'https://66.media.tumblr.com/0123456789abcdef0123456789abcdef/tumblr_p1a2b3C4d5E6f7g8o1_1280.jpg',
      url,
    ]);
    expect(fullSizeUrls('https://78.media.tumblr.com/tumblr_inline_abc123_r1_540.png')[0]).toBe(
      'https://78.media.tumblr.com/tumblr_inline_abc123_r1_1280.png',
    );
    expect(fullSizeUrls('https://66.media.tumblr.com/tumblr_abc123_75sq.gif')[0]).toBe('https://66.media.tumblr.com/tumblr_abc123_1280.gif');
  });

  it('leaves new-style addresses alone', () => {
    const url = 'https://64.media.tumblr.com/0123456789abcdef0123456789abcdef/fedcba9876543210-ab/s640x960/0011223344556677.jpg';
    expect(fullSizeUrls(url)).toEqual([url]);
  });
});

describe('other addresses', () => {
  it('returns the address alone', () => {
    for (const url of [
      'https://example.com/photo_500.jpg',
      'data:image/png;base64,iVBORw0KGgo=',
      'blob:https://example.com/0f3a',
      'not a url',
    ]) {
      expect(fullSizeUrls(url)).toEqual([url]);
    }
  });
});
