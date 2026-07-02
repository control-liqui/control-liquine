"use client";

import { useState } from "react";
import type { Product, Movement, ViewType } from "@/types/product";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search as SearchIcon,
  Package,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Eye,
} from "lucide-react";

interface SearchProps {
  products: Product[];
  movements: Movement[];
  onNavigate: (view: ViewType) => void;
}

export function Search({ products, movements, onNavigate }: SearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"productos" | "movimientos">("productos");

  // Buscar productos
  const filteredProducts = products.filter(
    (p) =>
      searchTerm &&
      (p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.grupo.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Buscar movimientos
  const filteredMovements = movements.filter(
    (m) =>
      searchTerm &&
      (m.productoNombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.productoCodigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.motivo.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getStockBadge = (product: Product) => {
    if (product.stockActual === 0) {
      return <Badge variant="destructive">Sin Stock</Badge>;
    }
    if (product.stockActual <= product.stockMinimo) {
      return <Badge className="bg-warning/20 text-warning-foreground">Stock Bajo</Badge>;
    }
    return <Badge className="bg-chart-2/20 text-chart-2">Disponible</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Buscar</h1>
        <p className="text-muted-foreground">Encuentra productos y movimientos en el sistema</p>
      </div>

      {/* Search Input */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative max-w-xl">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, código, grupo o motivo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-12 text-lg"
              autoFocus
            />
          </div>
          {searchTerm && (
            <p className="text-sm text-muted-foreground mt-3">
              {filteredProducts.length} productos y {filteredMovements.length} movimientos encontrados
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {searchTerm && (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "productos" | "movimientos")}>
          <TabsList>
            <TabsTrigger value="productos" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Productos ({filteredProducts.length})
            </TabsTrigger>
            <TabsTrigger value="movimientos" className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Movimientos ({filteredMovements.length})
            </TabsTrigger>
          </TabsList>

          {/* Productos */}
          <TabsContent value="productos">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Package className="h-5 w-5 text-primary" />
                  Productos Encontrados
                </CardTitle>
                <CardDescription>
                  Resultados de la búsqueda en productos
                </CardDescription>
              </CardHeader>
              <CardContent>
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No se encontraron productos</p>
                  </div>
                ) : (
                  <div className="rounded-lg border overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Código</TableHead>
                          <TableHead>Nombre</TableHead>
                          <TableHead>Grupo</TableHead>
                          <TableHead className="text-right">Stock</TableHead>
                          <TableHead className="text-right">Precio</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead className="text-right">Acción</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredProducts.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono text-sm">{p.codigo}</TableCell>
                            <TableCell className="font-medium text-foreground">{p.nombre}</TableCell>
                            <TableCell className="text-muted-foreground">{p.grupo}</TableCell>
                            <TableCell className="text-right">{p.stockActual}</TableCell>
                            <TableCell className="text-right">
                              ${p.precio.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>{getStockBadge(p)}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onNavigate("inventario")}
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                Ver
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Movimientos */}
          <TabsContent value="movimientos">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <ArrowLeftRight className="h-5 w-5 text-primary" />
                  Movimientos Encontrados
                </CardTitle>
                <CardDescription>
                  Resultados de la búsqueda en movimientos
                </CardDescription>
              </CardHeader>
              <CardContent>
                {filteredMovements.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ArrowLeftRight className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No se encontraron movimientos</p>
                  </div>
                ) : (
                  <div className="rounded-lg border overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Código</TableHead>
                          <TableHead>Producto</TableHead>
                          <TableHead className="text-right">Cantidad</TableHead>
                          <TableHead>Motivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredMovements.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="text-muted-foreground">
                              {new Date(m.fecha).toLocaleDateString("es-MX")}
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={
                                  m.tipo === "entrada"
                                    ? "bg-chart-2/20 text-chart-2"
                                    : m.tipo === "salida"
                                    ? "bg-chart-3/20 text-chart-3"
                                    : "bg-primary/20 text-primary"
                                }
                              >
                                <span className="flex items-center gap-1">
                                  {m.tipo === "entrada" ? (
                                    <TrendingUp className="h-3 w-3" />
                                  ) : (
                                    <TrendingDown className="h-3 w-3" />
                                  )}
                                  {m.tipo.charAt(0).toUpperCase() + m.tipo.slice(1)}
                                </span>
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm">{m.productoCodigo}</TableCell>
                            <TableCell className="font-medium text-foreground">{m.productoNombre}</TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                m.tipo === "entrada" ? "text-chart-2" : "text-chart-3"
                              }`}
                            >
                              {m.tipo === "entrada" ? "+" : "-"}
                              {m.cantidad}
                            </TableCell>
                            <TableCell className="text-muted-foreground max-w-48 truncate">
                              {m.motivo}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Empty State */}
      {!searchTerm && (
        <Card>
          <CardContent className="py-16">
            <div className="text-center text-muted-foreground">
              <SearchIcon className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <h3 className="text-lg font-medium text-foreground mb-2">Busca en el sistema</h3>
              <p>Escribe en el campo de búsqueda para encontrar productos y movimientos</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
