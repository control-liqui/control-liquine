"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import type { Product, Movement, UnitOfMeasure, ProductGroup, Warehouse, ViewType } from "@/types/product";
import { Sidebar } from "@/components/sidebar";
import { Dashboard } from "@/components/dashboard";
import { NewProduct } from "@/components/new-product";
import { Movements } from "@/components/movements";
import { Inventory } from "@/components/inventory";
import { Reports } from "@/components/reports";
import { Search } from "@/components/search";

// Datos por defecto para unidades, grupos y almacenes
const defaultUnits: Omit<UnitOfMeasure, "id">[] = [
  { nombre: "Unidad", abreviatura: "UND" },
  { nombre: "Kilogramo", abreviatura: "KG" },
  { nombre: "Litro", abreviatura: "LT" },
  { nombre: "Metro", abreviatura: "M" },
  { nombre: "Caja", abreviatura: "CJ" },
  { nombre: "Paquete", abreviatura: "PQ" },
];

const defaultGroups: Omit<ProductGroup, "id">[] = [
  { nombre: "Electrónica", descripcion: "Productos electrónicos" },
  { nombre: "Alimentos", descripcion: "Productos alimenticios" },
  { nombre: "Limpieza", descripcion: "Productos de limpieza" },
  { nombre: "Oficina", descripcion: "Artículos de oficina" },
  { nombre: "Herramientas", descripcion: "Herramientas y equipos" },
];

const defaultWarehouses: Omit<Warehouse, "id">[] = [
  { nombre: "Almacén Principal", ubicacion: "Zona A" },
  { nombre: "Almacén Secundario", ubicacion: "Zona B" },
  { nombre: "Bodega", ubicacion: "Zona C" },
];

export function StockApp() {
  const [currentView, setCurrentView] = useState<ViewType>("dashboard");
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Cargar datos de Firebase
  useEffect(() => {
    const unsubProducts = onSnapshot(
      query(collection(db, "products"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate() || new Date(),
          updatedAt: doc.data().updatedAt?.toDate() || new Date(),
        })) as Product[];
        setProducts(data);
        setLoading(false);
      }
    );

    const unsubMovements = onSnapshot(
      query(collection(db, "movements"), orderBy("fecha", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          fecha: doc.data().fecha?.toDate() || new Date(),
          createdAt: doc.data().createdAt?.toDate() || new Date(),
        })) as Movement[];
        setMovements(data);
      }
    );

    const unsubUnits = onSnapshot(collection(db, "units"), (snapshot) => {
      if (snapshot.empty) {
        // Crear unidades por defecto
        defaultUnits.forEach((unit) => addDoc(collection(db, "units"), unit));
      } else {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as UnitOfMeasure[];
        setUnits(data);
      }
    });

    const unsubGroups = onSnapshot(collection(db, "groups"), (snapshot) => {
      if (snapshot.empty) {
        // Crear grupos por defecto
        defaultGroups.forEach((group) => addDoc(collection(db, "groups"), group));
      } else {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as ProductGroup[];
        setGroups(data);
      }
    });

    const unsubWarehouses = onSnapshot(collection(db, "warehouses"), (snapshot) => {
      if (snapshot.empty) {
        // Crear almacenes por defecto
        defaultWarehouses.forEach((wh) => addDoc(collection(db, "warehouses"), wh));
      } else {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Warehouse[];
        setWarehouses(data);
      }
    });

    return () => {
      unsubProducts();
      unsubMovements();
      unsubUnits();
      unsubGroups();
      unsubWarehouses();
    };
  }, []);

  // Funciones CRUD para productos
  const addProduct = async (product: Omit<Product, "id" | "createdAt" | "updatedAt">) => {
    await addDoc(collection(db, "products"), {
      ...product,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  };

  const updateProduct = async (id: string, product: Partial<Product>) => {
    await updateDoc(doc(db, "products", id), {
      ...product,
      updatedAt: Timestamp.now(),
    });
  };

  const deleteProduct = async (id: string) => {
    await deleteDoc(doc(db, "products", id));
  };

  // Funciones para movimientos
  const addMovement = async (movement: Omit<Movement, "id" | "createdAt">) => {
    await addDoc(collection(db, "movements"), {
      ...movement,
      fecha: Timestamp.fromDate(movement.fecha),
      createdAt: Timestamp.now(),
    });

    // Actualizar stock del producto
    const product = products.find((p) => p.id === movement.productoId);
    if (product) {
      let newStock = product.stockActual;
      if (movement.tipo === "entrada") {
        newStock += movement.cantidad;
      } else if (movement.tipo === "salida") {
        newStock -= movement.cantidad;
      }
      await updateProduct(movement.productoId, { stockActual: newStock });
    }
  };

  const renderView = () => {
    switch (currentView) {
      case "dashboard":
        return <Dashboard products={products} movements={movements} loading={loading} />;
      case "nuevo-producto":
        return (
          <NewProduct
            units={units}
            groups={groups}
            onSave={addProduct}
            onNavigate={setCurrentView}
          />
        );
      case "movimientos":
        return (
          <Movements
            products={products}
            movements={movements}
            warehouses={warehouses}
            onAddMovement={addMovement}
          />
        );
      case "inventario":
        return (
          <Inventory
            products={products}
            units={units}
            groups={groups}
            onUpdate={updateProduct}
            onDelete={deleteProduct}
          />
        );
      case "reportes":
        return <Reports products={products} movements={movements} />;
      case "buscar":
        return (
          <Search
            products={products}
            movements={movements}
            onNavigate={setCurrentView}
          />
        );
      default:
        return <Dashboard products={products} movements={movements} loading={loading} />;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        currentView={currentView}
        onNavigate={setCurrentView}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      <main className={`flex-1 overflow-auto transition-all duration-300 ${sidebarOpen ? "ml-64" : "ml-16"}`}>
        <div className="p-6">{renderView()}</div>
      </main>
    </div>
  );
}
