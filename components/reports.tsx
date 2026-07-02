"use client";

import { useState, useRef } from "react";
import type { Product, Movement } from "@/types/product";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileBarChart,
  Boxes,
  ArrowLeftRight,
  AlertTriangle,
  Download,
  Calendar,
  Printer,
} from "lucide-react";

interface ReportsProps {
  products: Product[];
  movements: Movement[];
}

type ReportType = "inventario" | "movimientos" | "stock-bajo";

export function Reports({ products, movements }: ReportsProps) {
  const [activeTab, setActiveTab] = useState<ReportType>("inventario");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

  // Filtrar movimientos por fecha
  const filteredMovements = movements.filter((m) => {
    if (!dateFrom && !dateTo) return true;
    const movDate = new Date(m.fecha);
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;
    if (from && movDate < from) return false;
    if (to && movDate > to) return false;
    return true;
  });

  // Productos con stock bajo o sin stock
  const lowStockProducts = products.filter(
    (p) => p.stockActual <= p.stockMinimo
  );

  // Calcular totales para el reporte
  const totalProducts = products.length;
  const totalValue = products.reduce((acc, p) => acc + p.stockActual * p.precio, 0);
  const totalUnits = products.reduce((acc, p) => acc + p.stockActual, 0);

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = (type: ReportType) => {
    let csvContent = "";
    let filename = "";

    if (type === "inventario") {
      filename = "reporte_inventario.csv";
      csvContent = "Codigo,Nombre,Grupo,Unidad,Stock,Stock Minimo,Precio,Valor Total\n";
      products.forEach((p) => {
        csvContent += `${p.codigo},${p.nombre},${p.grupo},${p.unidadMedida},${p.stockActual},${p.stockMinimo},${p.precio},${p.stockActual * p.precio}\n`;
      });
    } else if (type === "movimientos") {
      filename = "reporte_movimientos.csv";
      csvContent = "Fecha,Tipo,Codigo,Producto,Cantidad,Motivo\n";
      filteredMovements.forEach((m) => {
        csvContent += `${new Date(m.fecha).toLocaleDateString("es-MX")},${m.tipo},${m.productoCodigo},${m.productoNombre},${m.cantidad},${m.motivo}\n`;
      });
    } else {
      filename = "reporte_stock_bajo.csv";
      csvContent = "Codigo,Nombre,Stock Actual,Stock Minimo,Estado\n";
      lowStockProducts.forEach((p) => {
        const estado = p.stockActual === 0 ? "Sin Stock" : "Stock Bajo";
        csvContent += `${p.codigo},${p.nombre},${p.stockActual},${p.stockMinimo},${estado}\n`;
      });
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reportes</h1>
        <p className="text-muted-foreground">Genera reportes del inventario y movimientos</p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReportType)}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="inventario" className="flex items-center gap-2">
            <Boxes className="h-4 w-4" />
            Inventario
          </TabsTrigger>
          <TabsTrigger value="movimientos" className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            Movimientos
          </TabsTrigger>
          <TabsTrigger value="stock-bajo" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Stock Bajo
          </TabsTrigger>
        </TabsList>

        {/* Reporte de Inventario */}
        <TabsContent value="inventario">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <FileBarChart className="h-5 w-5 text-primary" />
                  Reporte de Inventario Actual
                </CardTitle>
                <CardDescription>
                  Lista completa de productos con su valor en inventario
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-2" />
                  Imprimir
                </Button>
                <Button size="sm" onClick={() => handleExportCSV("inventario")}>
                  <Download className="h-4 w-4 mr-2" />
                  Exportar CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent ref={printRef}>
              {/* Resumen */}
              <div className="grid gap-4 sm:grid-cols-3 mb-6">
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">Total Productos</p>
                  <p className="text-2xl font-bold text-foreground">{totalProducts}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">Total Unidades</p>
                  <p className="text-2xl font-bold text-foreground">{totalUnits.toLocaleString()}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">Valor Total</p>
                  <p className="text-2xl font-bold text-foreground">
                    ${totalValue.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Tabla */}
              <div className="rounded-lg border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Grupo</TableHead>
                      <TableHead>Unidad</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead className="text-right">Precio</TableHead>
                      <TableHead className="text-right">Valor Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-sm">{p.codigo}</TableCell>
                        <TableCell className="font-medium text-foreground">{p.nombre}</TableCell>
                        <TableCell className="text-muted-foreground">{p.grupo}</TableCell>
                        <TableCell className="text-muted-foreground">{p.unidadMedida}</TableCell>
                        <TableCell className="text-right">{p.stockActual}</TableCell>
                        <TableCell className="text-right">
                          ${p.precio.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-medium text-foreground">
                          ${(p.stockActual * p.precio).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reporte de Movimientos */}
        <TabsContent value="movimientos">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Calendar className="h-5 w-5 text-primary" />
                  Reporte de Movimientos
                </CardTitle>
                <CardDescription>
                  Historial de movimientos filtrado por fecha
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-2" />
                  Imprimir
                </Button>
                <Button size="sm" onClick={() => handleExportCSV("movimientos")}>
                  <Download className="h-4 w-4 mr-2" />
                  Exportar CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Filtros de fecha */}
              <div className="flex flex-wrap gap-4 mb-6 items-end">
                <div className="space-y-2">
                  <Label>Desde</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Hasta</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-40"
                  />
                </div>
                {(dateFrom || dateTo) && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDateFrom("");
                      setDateTo("");
                    }}
                  >
                    Limpiar filtros
                  </Button>
                )}
              </div>

              {/* Resumen */}
              <div className="grid gap-4 sm:grid-cols-3 mb-6">
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">Total Movimientos</p>
                  <p className="text-2xl font-bold text-foreground">{filteredMovements.length}</p>
                </div>
                <div className="bg-chart-2/10 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">Entradas</p>
                  <p className="text-2xl font-bold text-chart-2">
                    {filteredMovements.filter((m) => m.tipo === "entrada").length}
                  </p>
                </div>
                <div className="bg-chart-3/10 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">Salidas</p>
                  <p className="text-2xl font-bold text-chart-3">
                    {filteredMovements.filter((m) => m.tipo === "salida").length}
                  </p>
                </div>
              </div>

              {/* Tabla */}
              <div className="rounded-lg border overflow-auto max-h-96">
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
                    {filteredMovements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No hay movimientos en el rango seleccionado
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMovements.map((m) => (
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
                              {m.tipo.charAt(0).toUpperCase() + m.tipo.slice(1)}
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
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reporte de Stock Bajo */}
        <TabsContent value="stock-bajo">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <AlertTriangle className="h-5 w-5 text-warning" />
                  Productos con Stock Bajo
                </CardTitle>
                <CardDescription>
                  Lista de productos que necesitan reposición
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-2" />
                  Imprimir
                </Button>
                <Button size="sm" onClick={() => handleExportCSV("stock-bajo")}>
                  <Download className="h-4 w-4 mr-2" />
                  Exportar CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Resumen */}
              <div className="grid gap-4 sm:grid-cols-2 mb-6">
                <div className="bg-warning/10 rounded-lg p-4 border border-warning/20">
                  <p className="text-sm text-muted-foreground">Stock Bajo</p>
                  <p className="text-2xl font-bold text-warning-foreground">
                    {lowStockProducts.filter((p) => p.stockActual > 0).length}
                  </p>
                </div>
                <div className="bg-destructive/10 rounded-lg p-4 border border-destructive/20">
                  <p className="text-sm text-muted-foreground">Sin Stock</p>
                  <p className="text-2xl font-bold text-destructive">
                    {lowStockProducts.filter((p) => p.stockActual === 0).length}
                  </p>
                </div>
              </div>

              {/* Tabla */}
              <div className="rounded-lg border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Grupo</TableHead>
                      <TableHead className="text-right">Stock Actual</TableHead>
                      <TableHead className="text-right">Stock Mínimo</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Unidades Faltantes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStockProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No hay productos con stock bajo
                        </TableCell>
                      </TableRow>
                    ) : (
                      lowStockProducts.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-sm">{p.codigo}</TableCell>
                          <TableCell className="font-medium text-foreground">{p.nombre}</TableCell>
                          <TableCell className="text-muted-foreground">{p.grupo}</TableCell>
                          <TableCell
                            className={`text-right font-medium ${
                              p.stockActual === 0 ? "text-destructive" : "text-warning-foreground"
                            }`}
                          >
                            {p.stockActual}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {p.stockMinimo}
                          </TableCell>
                          <TableCell>
                            {p.stockActual === 0 ? (
                              <Badge variant="destructive">Sin Stock</Badge>
                            ) : (
                              <Badge className="bg-warning/20 text-warning-foreground">
                                Stock Bajo
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium text-foreground">
                            {p.stockMinimo - p.stockActual}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
