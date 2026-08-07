module Hunker.FileTree exposing (Tree(..), build, directoryPaths, reveal)


type Tree item
    = Folder String String (List (Tree item))
    | Leaf String item


build : (item -> String) -> List item -> List (Tree item)
build pathOf items =
    items
        |> List.foldl
            (\item forest ->
                insert item (String.split "/" (pathOf item)) "" forest
            )
            []
        |> sortForest


insert : item -> List String -> String -> List (Tree item) -> List (Tree item)
insert item segments parent forest =
    case segments of
        [] ->
            forest

        [ name ] ->
            Leaf name item :: forest

        name :: rest ->
            let
                path =
                    if parent == "" then
                        name

                    else
                        parent ++ "/" ++ name

                update tree =
                    case tree of
                        Folder candidateName candidatePath children ->
                            if candidateName == name then
                                Folder candidateName candidatePath (insert item rest path children)

                            else
                                tree

                        Leaf _ _ ->
                            tree
            in
            if List.any (isFolderNamed name) forest then
                List.map update forest

            else
                Folder name path (insert item rest path []) :: forest


isFolderNamed : String -> Tree item -> Bool
isFolderNamed name tree =
    case tree of
        Folder candidate _ _ ->
            candidate == name

        Leaf _ _ ->
            False


sortForest : List (Tree item) -> List (Tree item)
sortForest forest =
    forest
        |> List.map
            (\tree ->
                case tree of
                    Folder name path children ->
                        Folder name path (sortForest children)

                    Leaf _ _ ->
                        tree
            )
        |> List.sortBy sortKey


sortKey : Tree item -> String
sortKey tree =
    case tree of
        Folder name _ _ ->
            "0-" ++ String.toLower name

        Leaf name _ ->
            "1-" ++ String.toLower name


directoryPaths : List (Tree item) -> List String
directoryPaths forest =
    List.concatMap
        (\tree ->
            case tree of
                Folder _ path children ->
                    path :: directoryPaths children

                Leaf _ _ ->
                    []
        )
        forest


reveal : String -> List String -> List String
reveal filePath collapsed =
    ancestors filePath
        |> List.foldl remove collapsed


remove : String -> List String -> List String
remove path =
    List.filter ((/=) path)


ancestors : String -> List String
ancestors filePath =
    let
        segments =
            String.split "/" filePath

        go consumed remaining =
            case remaining of
                [] ->
                    []

                [ _ ] ->
                    []

                first :: rest ->
                    let
                        next =
                            consumed ++ [ first ]
                    in
                    String.join "/" next :: go next rest
    in
    go [] segments
