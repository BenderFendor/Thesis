import Link from "next/link";
import { navLinks } from "@/lib/constants";

interface FooterProps {
  hidden: boolean;
}

const Footer = ({ hidden }: FooterProps) => {
  return (
    <footer
      className={`bg-background text-foreground py-8 px-4 md:px-6 border-t transition-transform duration-300 ${
        hidden ? "translate-y-full" : "translate-y-0"
      }`}
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
      }}
    >
      <div className="container mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="flex flex-col gap-4">
          <Link href="#" className="flex items-center gap-2" prefetch={false}>
            <GlobeIcon className="h-6 w-6" />
            <span className="font-semibold text-lg">GlobalNews</span>
          </Link>
          <p className="text-muted-foreground text-sm">
            Multi-perspective news aggregation platform bringing you diverse viewpoints from around the world.
          </p>
        </div>
        {navLinks.map((section) => (
          <div key={section.title} className="grid gap-2">
            <h4 className="font-semibold">{section.title}</h4>
            {section.links.map((link) => (
              <Link
                key={link.title}
                href={link.href}
                className="text-muted-foreground hover:text-foreground text-sm"
                prefetch={false}
              >
                {link.title}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="container mx-auto mt-8 flex items-center justify-between text-sm text-muted-foreground">
        <p>&copy; 2024 GlobalNews. Built with Next.js and Three.js.</p>
      </div>
    </footer>
  );
};

function GlobeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

export default Footer;
