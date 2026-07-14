# Contrato de espaciado

Este contrato aplica a páginas públicas, Portal, correos visuales y herramientas internas. Su objetivo es que `padding`, `margin`, `gap` y gutters respondan al mismo sistema, sin depender de la memoria de quien edita una pantalla.

## Escala

La unidad base es **8 CSS px**. La escala principal usa múltiplos de 8:

| Token | Valor | Uso habitual |
| --- | ---: | --- |
| `--space-1` | 8 px | separación mínima entre elementos relacionados |
| `--space-2` | 16 px | padding de controles y grupos compactos |
| `--space-3` | 24 px | tarjetas, grids y bloques de contenido |
| `--space-4` | 32 px | gutters amplios y separación de secciones |
| `--space-5` | 40 px | bloques editoriales |
| `--space-6` | 48 px | inicio o cierre de secciones compactas |
| `--space-8` | 64 px | secciones de página |
| `--space-10` | 80 px | secciones amplias |
| `--space-12` | 96 px | ritmo vertical de escritorio |
| `--space-14` | 112 px | composiciones editoriales amplias |
| `--space-16` | 128 px | separación excepcional de portada |

`8 / 16 / 24 / 32` son los pasos preferidos. Los pasos superiores siguen siendo parte de la misma rejilla y se reservan para layouts amplios.

## Tokens semánticos

- `--layout-gutter`: borde lateral adaptable de una página.
- `--layout-section-y`: aire vertical adaptable entre secciones.
- `--layout-stack-sm`, `--layout-stack-md`, `--layout-stack-lg`: separación de elementos apilados.
- `--layout-grid-gap`: separación predeterminada de grids.

Las utilidades compartidas son:

- `.layout-container`: ancho máximo y gutter horizontal.
- `.layout-section`: ritmo vertical de sección.
- `.layout-stack`: flujo vertical; acepta `--layout-stack` como ajuste local tokenizado.
- `.layout-grid`: grid; acepta `--layout-gap` como ajuste local tokenizado.
- `.layout-cluster`: fila adaptable con salto de línea; acepta `--layout-gap`.

Ejemplo:

```html
<section class="layout-section">
  <div class="layout-container layout-stack" style="--layout-stack: var(--space-3)">
    <!-- contenido -->
  </div>
</section>
```

## Reglas obligatorias

1. Un layout nuevo usa tokens CSS o clases Tailwind que equivalgan a múltiplos de 8. En Tailwind eso significa pasos pares: `2`, `4`, `6`, `8`, etc.
2. No se agregan valores arbitrarios como `gap-[18px]`, `p-[22px]`, `gap-3`, `p-5` o `py-3.5`.
3. Los componentes compartidos resuelven su espaciado internamente. Una página no corrige un componente con márgenes aislados.
4. Los gutters, secciones, stacks, grids y clusters usan las utilidades semánticas cuando corresponda.
5. Una excepción requiere comentario con motivo, responsable, ticket y fecha de revisión; además debe agregarse conscientemente a la línea base de auditoría.

## Lo que no es espaciado de layout

- Bordes de 1 o 2 px.
- El objetivo táctil mínimo interno de 44 × 44 px.
- Ajustes ópticos de iconos, subrayados o animaciones.
- Tamaños tipográficos, radios, sombras y dimensiones intrínsecas de imágenes.

Estos valores pueden no ser múltiplos de 8, pero no deben usarse como `padding`, `margin` o `gap` encubierto.

## Verificación automática

`npm run test:spacing` revisa código Astro, CSS, JavaScript y TypeScript. La línea base registra la deuda histórica por módulo: una edición no puede aumentarla ni trasladarla a otra área del producto. Cuando una corrección reduce el contador, la prueba exige bajar también la línea base para que esa deuda no pueda regresar.

Cuando un archivo llega a cero se agrega a `$strictFiles`. Desde ese momento cualquier infracción nueva en ese archivo bloquea el build, aunque otro archivo del mismo módulo haya mejorado.

La línea base no convierte una infracción histórica en una buena práctica. Solo permite migrar el sitio por módulos sin bloquear producción ni deformar pantallas existentes de una vez.
