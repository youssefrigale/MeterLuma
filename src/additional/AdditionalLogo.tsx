import { additionalLogos } from './logos';

export function AdditionalLogo({ id }: { id: string }) {
  const { src, monochrome } = additionalLogos[id];
  return monochrome
    ? <span className="additional-logo additional-logo-mask" aria-hidden="true" style={{ maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` }}/>
    : <img className="additional-logo" src={src} alt="" aria-hidden="true" draggable={false}/>;
}
