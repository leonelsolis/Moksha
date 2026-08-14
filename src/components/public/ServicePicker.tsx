"use client";

import { useState } from "react";

import { Icon } from "@/components/Icon";
import {
  countServices,
  type CatalogNode,
  type PublicCategory,
  type PublicService,
} from "@/lib/public-types";

/**
 * Elegir el servicio, un nivel por vez.
 *
 * El catálogo es un árbol —"Esmaltado semipermanente" y adentro los tipos que
 * hay—, y esta pantalla muestra siempre un solo nivel: las cards que se abren
 * arriba, los servicios que se eligen abajo. Un local con treinta servicios
 * mostrados de una sola vez obliga a leerlos todos para descartar veintiocho;
 * así se leen tres.
 *
 * La navegación es una ruta de nodos y nada más. No hay estado "abierto" por
 * card ni acordeones: se entra y se sale, y las migas de pan de arriba llevan
 * a cualquier nivel anterior de un toque. En el celular es lo mismo que hace
 * cualquier tienda, así que no hay nada que aprender.
 *
 * Un local que no creó ninguna categoría cae en el caso de siempre: la raíz no
 * tiene cards, todos los servicios están sueltos ahí y esto es la misma lista
 * plana que había antes.
 */

type Props = {
  catalog: CatalogNode;
  selected: PublicService | null;
  onSelect: (service: PublicService) => void;
};

export function ServicePicker({ catalog, selected, onSelect }: Props) {
  /** Categorías abiertas, de la primera a la actual. Vacío = primer nivel. */
  const [path, setPath] = useState<PublicCategory[]>([]);

  const node: CatalogNode = path.length > 0 ? path[path.length - 1] : catalog;

  /** Sube hasta cierto nivel. 0 = volver al principio. */
  const goTo = (depth: number) => setPath((current) => current.slice(0, depth));

  return (
    <div className="space-y-3">
      {path.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
          <button
            type="button"
            onClick={() => goTo(path.length - 1)}
            className="btn btn-ghost btn-sm -ml-2"
          >
            <Icon name="chevronLeft" className="size-3.5" />
            Volver
          </button>

          {/* Migas de pan: el nivel actual no es un botón porque ya se está
              parada ahí, y un botón que no lleva a ninguna parte solo se
              prueba una vez. */}
          <nav aria-label="Categorías" className="flex flex-wrap items-center gap-x-1">
            <Crumb onClick={() => goTo(0)}>Todos</Crumb>

            {path.map((category, index) => (
              <span key={category.id} className="flex items-center gap-x-1">
                <span aria-hidden="true" className="text-ink-muted">
                  ›
                </span>
                {index === path.length - 1 ? (
                  <span className="font-medium" aria-current="page">
                    {category.name}
                  </span>
                ) : (
                  <Crumb onClick={() => goTo(index + 1)}>{category.name}</Crumb>
                )}
              </span>
            ))}
          </nav>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {node.categories.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
            containsSelected={selected !== null && contains(category, selected.id)}
            onOpen={() => setPath((current) => [...current, category])}
          />
        ))}

        {node.services.map((service) => (
          <ServiceCard
            key={service.id}
            service={service}
            selected={selected?.id === service.id}
            onSelect={() => onSelect(service)}
          />
        ))}
      </div>

      {/* La advertencia va una sola vez al pie de la lista y no repetida en
          cada card: es la misma para todos los servicios, y en cada card
          competiría con el precio, que es lo que se vino a leer. Solo aparece
          si en este nivel hay algún precio a la vista. */}
      {node.services.some((service) => service.price != null) ? (
        <p className="text-xs text-ink-muted">
          El precio puede variar dependiendo de los adicionales.
        </p>
      ) : null}
    </div>
  );
}

function Crumb({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
    >
      {children}
    </button>
  );
}

/** ¿El servicio elegido está en esta rama? */
function contains(category: PublicCategory, serviceId: number): boolean {
  return (
    category.services.some((service) => service.id === serviceId) ||
    category.categories.some((child) => contains(child, serviceId))
  );
}

/**
 * Una card que se abre.
 *
 * Se marca cuando el servicio elegido está adentro: al volver de un nivel, es
 * lo que dice por dónde se había entrado sin tener que abrir de nuevo.
 */
function CategoryCard({
  category,
  containsSelected,
  onOpen,
}: {
  category: PublicCategory;
  containsSelected: boolean;
  onOpen: () => void;
}) {
  const total = countServices(category);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex items-start justify-between gap-3 rounded-sm border p-3 text-left transition-colors ${
        containsSelected
          ? "border-accent bg-accent-soft"
          : "border-line-strong bg-surface hover:bg-surface-sunken"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{category.name}</span>

        {category.description ? (
          <span className="mt-1 line-clamp-2 block text-xs text-ink-soft">
            {category.description}
          </span>
        ) : null}

        <span className="mt-1 block text-xs text-ink-muted tabular">
          {total} {total === 1 ? "opción" : "opciones"}
        </span>
      </span>

      <Icon name="chevronRight" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
    </button>
  );
}

function ServiceCard({
  service,
  selected,
  onSelect,
}: {
  service: PublicService;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-start justify-between gap-3 rounded-sm border p-3 text-left transition-colors ${
        selected
          ? "border-accent bg-accent-soft"
          : "border-line-strong bg-surface hover:bg-surface-sunken"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{service.name}</span>
        <span className="mt-1 block text-xs text-ink-soft tabular">
          {service.durationMinutes} min
        </span>
        {service.price != null ? (
          <span className="mt-1 block text-sm font-semibold text-accent tabular">
            ${service.price.toLocaleString("es-AR")}
          </span>
        ) : null}
      </span>

      {selected ? <Icon name="check" className="size-4 shrink-0 text-accent" /> : null}
    </button>
  );
}
