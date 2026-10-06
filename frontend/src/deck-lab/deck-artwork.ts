import type { BuilderProject } from '../../../shared/builder-project.mjs';
import type { ArtworkRequest } from '../../../shared/artwork.mjs';
/** Only the chosen printing and its faces; quantities and other editions add no downloads. */
export function collectDeckArtwork(project: BuilderProject, includeIdeas = false): ArtworkRequest {
  const cards = project.groups.filter(g=>includeIdeas || !g.maybeboard).flatMap(g=>g.entries.map(e=>e.card));
  if(includeIdeas)cards.push(...project.cuts);
  const urls=new Set<string>(),unavailable=new Set<string>();
  for(const card of cards) {
    const images=[card.image,...card.faces?.map(f=>f.image)??[]].filter(Boolean);
    if(!images.length)unavailable.add(card.name);
    for(const image of images) {
      try {
        const url=new URL(image);
        if(url.protocol!=='https:'||url.hostname!=='cards.scryfall.io'||url.port||url.username||url.password||!/\.(jpg|png)$/.test(url.pathname))throw Error();
        urls.add(url.origin+url.pathname);
      } catch {unavailable.add(card.name);}
    }
  }
  return {id:project.projectId,name:project.name,urls:[...urls],unavailable:unavailable.size};
}
