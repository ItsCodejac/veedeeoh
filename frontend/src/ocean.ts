import { VodItem } from './types';
import { escapeHtml } from './util';
import { openVodDetails } from './vod';

export const OCEAN_ITEMS: VodItem[] = [
  {
    id: 'ocean-shark-man',
    title: 'Shark Man With Riley Elliott',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1560275619-4662e36fa65c?auto=format&fit=crop&w=600&q=80',
    summary: 'Riley Elliott has a passion for sharks, and he is out to disprove the myths that surround these apex predators.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-planet-hd',
    title: 'Planet HD',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=600&q=80',
    summary: 'Experience the colorful flora and fauna of the Amazon, the magic of Africa, or the endless ocean depths.',
    genre: 'Nature',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-tide-pool',
    title: 'Life In A Tide Pool',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80',
    summary: 'The series Life in a Tide Pool explores the fascinating world of tide pools on coastal shores.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-blue-water-savages',
    title: 'Blue Water Savages',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
    summary: 'The release of the motion picture Jaws in 1975 ignited an irrational fear of marine predators.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-sharks-danger',
    title: 'Sharks - Danger In The Sea',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1560275619-4662e36fa65c?auto=format&fit=crop&w=600&q=80',
    summary: 'Examine sharks in their natural environments, study their behaviors and dispel common myths.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-conquerors',
    title: 'Conquerors',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=600&q=80',
    summary: 'The king crab, the pine processionary caterpillar, the lionfish and the fire ant in aquatic ecosystems.',
    genre: 'Nature',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-river-challenge',
    title: 'Animal River Challenge',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
    summary: 'Filmmaker and biologist Rainer Bergomaz forges his way into the rainforest rivers of Guyana.',
    genre: 'Wildlife',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-shark-squad',
    title: 'Shark Squad',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1560275619-4662e36fa65c?auto=format&fit=crop&w=600&q=80',
    summary: 'In some of the most remote regions on the planet, researchers dive deep into shark habitats.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-shark-dive-tv',
    title: 'Shark Dive TV',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=600&q=80',
    summary: 'The producers of the award winning series Blue World focus on all things underwater diving.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-when-sharks-attack',
    title: 'When Sharks Attack',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1560275619-4662e36fa65c?auto=format&fit=crop&w=600&q=80',
    summary: 'Find out exactly what happens when a swimmer\'s worst fear becomes reality.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-predators-different-kind',
    title: 'Predators of a Different Kind - In the World of the Unknown Sharks',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
    summary: 'With the aid of modern technology, reveal the unknown behavior of unusual marine species.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-pink-dolphin',
    title: 'Mystery of the Pink Dolphin',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80',
    summary: 'The Amazon Pink River Dolphin is one of the most mysterious species of the animal kingdom.',
    genre: 'Nature',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-sharks-big-five',
    title: 'Sharks: The Big Five',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1560275619-4662e36fa65c?auto=format&fit=crop&w=600&q=80',
    summary: 'Delve deep into the African waters and discover a new side of these prehistoric ocean predators.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-rise-great-white',
    title: 'Rise of the Great White Shark',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
    summary: 'The Great White Shark has been here for millions of years. How did it come to be one of the top apex predators?',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-whale-sharks-gentle-giants',
    title: 'Whale Sharks...Gentle Giants',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=600&q=80',
    summary: 'Whale Sharks, gentle giants of the sea, are nearly 50 feet in length and weigh over 30 tons.',
    genre: 'Nature',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-giants-of-fortune',
    title: 'Giants of Fortune',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80',
    summary: 'Things seem bleak for fisherman Zozimo and his family until the world\'s biggest fish appears.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-vicious-beauties-jellyfish',
    title: 'Vicious Beauties - The Secret World of Jellyfish',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=600&q=80',
    summary: 'Watching the graceful movement of these gelatinous animals is almost hypnotic.',
    genre: 'Nature',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-shark-divers-1',
    title: 'Shark Divers Part 1',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1560275619-4662e36fa65c?auto=format&fit=crop&w=600&q=80',
    summary: 'Shark divers study, photograph and interact with some of the most terrifying creatures on earth.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-shark-divers-2',
    title: 'Shark Divers Part 2',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1560275619-4662e36fa65c?auto=format&fit=crop&w=600&q=80',
    summary: 'Shark divers study, photograph and interact with some of the most terrifying creatures on earth.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-galapagos-realm-sharks',
    title: 'Galapagos Realm of Giant Sharks (2014)',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
    summary: 'In the far reaches of the Galapagos archipelago there is a remote island - Darwin Island.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-life-among-whales',
    title: 'A Life Among Whales',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80',
    summary: 'Weaving together natural history and biography, A Life Among Whales delves deep into the oceanic world.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-wild-and-alive',
    title: 'Wild And Alive',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=600&q=80',
    summary: 'To survive in the wild has never been easy. Explore marine life in coastal environments.',
    genre: 'Nature',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-oyster-farmers',
    title: 'The Oyster Farmers',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80',
    summary: 'Oysters were once a staple for people in the northeast USA, until over-harvesting changed coastal waters.',
    genre: 'Documentary',
    provider: 'Pluto TV'
  },
  {
    id: 'ocean-feeding-grounds-humpbacks',
    title: 'In the Feeding Grounds of the Humpback Whales',
    type: 'live',
    poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
    summary: 'In the warm Pacific just off the coast of Maui, a humpback whale mother has paired with her calf.',
    genre: 'Nature',
    provider: 'Pluto TV'
  }
];

export function renderOceanTvView(container: HTMLElement): void {
  container.innerHTML = '';

  OCEAN_ITEMS.forEach(item => {
    const card = document.createElement('div');
    card.style.cssText = 'background: #10141e; border: 1px solid rgba(56,189,248,0.25); border-radius: 16px; overflow: hidden; cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease; position: relative;';
    card.onmouseover = () => { card.style.transform = 'translateY(-4px)'; card.style.borderColor = '#38bdf8'; };
    card.onmouseout = () => { card.style.transform = 'none'; card.style.borderColor = 'rgba(56,189,248,0.25)'; };

    card.innerHTML = `
      <div style="height: 150px; position: relative; overflow: hidden;">
        <img src="${item.poster || ''}" alt="${escapeHtml(item.title)}" style="width: 100%; height: 100%; object-fit: cover;" />
        <div style="position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(6,7,10,0.95) 100%);"></div>
        <div style="position: absolute; bottom: 12px; left: 12px; right: 12px; display: flex; align-items: center; justify-content: space-between;">
          <span style="background: rgba(56,189,248,0.25); backdrop-filter: blur(8px); border: 1px solid rgba(56,189,248,0.4); color: #38bdf8; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 800;">LIVE STREAM</span>
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #38bdf8; color: #06070a; display: flex; align-items: center; justify-content: center; font-weight: bold;">▶</div>
        </div>
      </div>
      <div style="padding: 16px;">
        <h4 style="margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #fff;">${escapeHtml(item.title)}</h4>
        <p style="margin: 0; font-size: 12px; color: #9aa5b5; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(item.summary)}</p>
      </div>
    `;

    card.onclick = () => {
      openVodDetails(item);
    };

    container.appendChild(card);
  });
}
