import {useEffect,useState} from 'react';

// Deferring rendering does not debounce HTTP requests; wait for typing to pause.
export function useDebouncedValue<T>(value:T,delay=300){
 const [settled,setSettled]=useState(value);
 useEffect(()=>{const timer=setTimeout(()=>setSettled(value),delay);return()=>clearTimeout(timer);},[value,delay]);
 return settled;
}
