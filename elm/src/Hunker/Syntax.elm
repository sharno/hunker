module Hunker.Syntax exposing (line)

import Html exposing (Html, span, text)
import Html.Attributes exposing (class)
import Regex


line : Bool -> String -> String -> List (Html msg)
line enabled path source =
    if not enabled then
        [ text source ]

    else if isComment path (String.trimLeft source) then
        [ span [ class "syntax-comment" ] [ text source ] ]

    else
        Regex.find tokenExpression source
            |> List.map (token path)


token : String -> Regex.Match -> Html msg
token path matched =
    let
        value =
            matched.match

        tokenClass =
            if isString value then
                "syntax-string"

            else if String.toInt value /= Nothing || String.toFloat value /= Nothing then
                "syntax-number"

            else if List.member value (keywords path) then
                "syntax-keyword"

            else if startsUpper value then
                "syntax-type"

            else
                "syntax-plain"
    in
    span [ class tokenClass ] [ text value ]


tokenExpression : Regex.Regex
tokenExpression =
    Regex.fromString "\"([^\"\\\\]|\\\\.)*\"|'([^'\\\\]|\\\\.)*'|[A-Za-z_$][A-Za-z0-9_$-]*|[0-9]+(?:\\.[0-9]+)?|\\s+|."
        |> Maybe.withDefault Regex.never


isString : String -> Bool
isString value =
    String.startsWith "\"" value || String.startsWith "'" value


startsUpper : String -> Bool
startsUpper value =
    value
        |> String.uncons
        |> Maybe.map (Tuple.first >> Char.isUpper)
        |> Maybe.withDefault False


isComment : String -> String -> Bool
isComment path value =
    String.startsWith "//" value
        || String.startsWith "/*" value
        || String.startsWith "*" value
        || (isPython path && String.startsWith "#" value)
        || (isSql path && String.startsWith "--" value)


keywords : String -> List String
keywords path =
    if isPython path then
        [ "and", "as", "async", "await", "class", "def", "elif", "else", "except", "False", "finally", "for", "from", "if", "import", "in", "is", "lambda", "None", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield" ]

    else if String.endsWith ".rs" path then
        [ "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while" ]

    else if String.endsWith ".tf" path || String.endsWith ".hcl" path || String.endsWith ".tofu" path then
        [ "data", "dynamic", "for", "if", "in", "locals", "module", "output", "provider", "resource", "terraform", "variable" ]

    else
        [ "abstract", "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "declare", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "of", "private", "protected", "public", "readonly", "return", "static", "super", "switch", "this", "throw", "true", "try", "type", "typeof", "undefined", "var", "void", "while", "with", "yield" ]


isPython : String -> Bool
isPython path =
    String.endsWith ".py" path || String.endsWith ".pyi" path


isSql : String -> Bool
isSql path =
    String.endsWith ".sql" path
